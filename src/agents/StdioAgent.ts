// StdioAgent: wraps any subprocess that speaks line-delimited JSON over stdin/stdout.
// Lets external agents (Python, Go, compiled binaries, HTTP-wrapping shims) plug
// into FidelityBench without any TypeScript code on their side.
//
// Protocol (one JSON object per line):
//
//   bench → agent:  {"type":"reset"}
//   bench → agent:  {"type":"input","input":<AgentInput>}
//   agent → bench:                  {"type":"output","output":<AgentOutput>}
//
// Agent must respond to every "input" with exactly one "output" line. "reset"
// expects no response. Stderr is forwarded to the bench's stderr for debugging.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isRestaurantSearchArgs(value: unknown): value is RestaurantSearchArgs {
  if (!isRecord(value)) return false
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue
    if (k === "partySize" || k === "maxPricePerPerson") {
      if (typeof v !== "number") return false
    } else if (k === "requiresVegetarian" || k === "avoidShellfish") {
      if (typeof v !== "boolean") return false
    } else {
      if (typeof v !== "string") return false
    }
  }
  return true
}

function isHoldReservationArgs(value: unknown): value is HoldReservationArgs {
  return (
    isRecord(value) &&
    typeof value.restaurantId === "string" &&
    typeof value.date === "string" &&
    typeof value.time === "string" &&
    typeof value.partySize === "number"
  )
}

// Returns the validated tool call, OR a string explaining why the input was
// rejected. Surfacing the reason matters: silently dropping bad tool calls
// makes external agents look "dumb" when the real failure is an adapter
// contract mismatch (e.g. snake_case args, wrong tool name).
function toToolCallOrReason(value: unknown): ToolCall | string {
  if (!isRecord(value)) return "tool call is not an object"
  if (typeof value.tool !== "string") return "missing string field 'tool'"
  if (value.tool === "restaurants.search") {
    if (!isRestaurantSearchArgs(value.args)) {
      return `tool 'restaurants.search' has malformed args: ${JSON.stringify(value.args)}`
    }
    return { tool: "restaurants.search", args: value.args }
  }
  if (value.tool === "restaurants.holdReservation") {
    if (!isHoldReservationArgs(value.args)) {
      return `tool 'restaurants.holdReservation' has malformed args: ${JSON.stringify(value.args)}`
    }
    return { tool: "restaurants.holdReservation", args: value.args }
  }
  return `unknown tool name '${value.tool}' (expected 'restaurants.search' or 'restaurants.holdReservation')`
}

function parseAgentOutput(value: unknown, agentName: string): AgentOutput {
  if (!isRecord(value)) {
    process.stderr.write(`[${agentName}] output is not a JSON object — skipping\n`)
    return { message: "" }
  }
  const msg = typeof value.message === "string" ? value.message : ""
  if (typeof value.message !== "string") {
    process.stderr.write(`[${agentName}] output is missing string 'message' field\n`)
  }
  const rawCalls = Array.isArray(value.toolCalls)
    ? value.toolCalls
    : "tool_calls" in value && Array.isArray((value as Record<string, unknown>).tool_calls)
      ? (value as Record<string, unknown>).tool_calls as unknown[]
      : []
  if (
    !Array.isArray(value.toolCalls) &&
    "tool_calls" in value &&
    Array.isArray((value as Record<string, unknown>).tool_calls)
  ) {
    process.stderr.write(
      `[${agentName}] used 'tool_calls' (snake_case); the protocol expects 'toolCalls'. Accepted, but please update your adapter.\n`,
    )
  }
  const toolCalls: ToolCall[] = []
  for (const candidate of rawCalls) {
    const result = toToolCallOrReason(candidate)
    if (typeof result === "string") {
      process.stderr.write(`[${agentName}] dropping tool call — ${result}\n`)
      continue
    }
    toolCalls.push(result)
  }
  return toolCalls.length > 0 ? { message: msg, toolCalls } : { message: msg }
}

export type StdioAgentOptions = {
  name: string
  command: string
  args?: string[]
  cwd?: string
  timeoutMs?: number
}

export class StdioAgent implements Agent {
  readonly name: string
  private readonly command: string
  private readonly args: string[]
  private readonly cwd?: string
  private readonly timeoutMs: number
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ""
  private pendingResolve: ((output: AgentOutput) => void) | null = null
  private pendingReject: ((error: Error) => void) | null = null

  constructor(options: StdioAgentOptions) {
    this.name = options.name
    this.command = options.command
    this.args = options.args ?? []
    this.cwd = options.cwd
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  async reset(): Promise<void> {
    if (this.child) {
      try {
        this.send({ type: "reset" })
        return
      } catch {
        // fall through to respawn
      }
    }
    this.spawnChild()
  }

  // Explicitly tear down the subprocess so the parent process can exit.
  // Called after all scenarios run; safe to call multiple times.
  dispose(): void {
    if (!this.child) return
    try {
      this.child.stdin.end()
    } catch {
      // ignore
    }
    try {
      this.child.kill("SIGTERM")
    } catch {
      // ignore
    }
    this.child = null
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (!this.child) this.spawnChild()
    return new Promise<AgentOutput>((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject
      const timer = setTimeout(() => {
        if (this.pendingReject) {
          const r = this.pendingReject
          this.pendingResolve = null
          this.pendingReject = null
          r(new Error(`StdioAgent[${this.name}] timed out after ${this.timeoutMs}ms`))
        }
      }, this.timeoutMs)
      try {
        this.send({ type: "input", input })
      } catch (error) {
        clearTimeout(timer)
        this.pendingResolve = null
        this.pendingReject = null
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      // wrap resolve to clear timer
      const origResolve = this.pendingResolve
      this.pendingResolve = (output) => {
        clearTimeout(timer)
        if (origResolve) origResolve(output)
      }
    })
  }

  private spawnChild() {
    if (this.child) {
      try {
        this.child.kill("SIGTERM")
      } catch {
        // ignore
      }
    }
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams
    this.child = child
    this.buffer = ""

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk
      this.drainBuffer()
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      process.stderr.write(`[${this.name}] ${chunk}`)
    })
    child.on("error", (error) => {
      if (this.pendingReject) {
        const r = this.pendingReject
        this.pendingResolve = null
        this.pendingReject = null
        r(error)
      }
    })
    child.on("close", (code) => {
      if (this.pendingReject) {
        const r = this.pendingReject
        this.pendingResolve = null
        this.pendingReject = null
        r(new Error(`StdioAgent[${this.name}] subprocess exited with code ${code} before responding`))
      }
      this.child = null
    })
  }

  private drainBuffer() {
    let newlineIdx = this.buffer.indexOf("\n")
    while (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim()
      this.buffer = this.buffer.slice(newlineIdx + 1)
      if (line.length > 0) this.handleLine(line)
      newlineIdx = this.buffer.indexOf("\n")
    }
  }

  private handleLine(line: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      process.stderr.write(`[${this.name}] non-JSON output: ${line}\n`)
      return
    }
    if (!isRecord(parsed) || parsed.type !== "output") {
      process.stderr.write(`[${this.name}] unexpected message: ${line}\n`)
      return
    }
    const output = parseAgentOutput(parsed.output, this.name)
    if (this.pendingResolve) {
      const r = this.pendingResolve
      this.pendingResolve = null
      this.pendingReject = null
      r(output)
    }
  }

  private send(message: { type: "reset" } | { type: "input"; input: AgentInput }) {
    if (!this.child) throw new Error(`StdioAgent[${this.name}] subprocess not running`)
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }
}
