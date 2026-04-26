// WindowedTranscriptLLMAgent: like TranscriptLLMAgent, but only the most
// recent N chars/messages of history are sent to the LLM at response time.
// The agent stores the full transcript internally; the window is applied
// just before the LLM call.
//
// This is the architecture-discriminating baseline introduced for
// alex_pushback_overflow_001 (and any future overflow scenario). The
// motivating claim:
//
//   "Linear transcript context is competitive when relevant context is
//    short and visible, but brittle when the useful constellation is
//    old, distributed, and buried in realistic noise."
//
// To make that claim testable without waiting on a real provider's
// context window, we engineer the window via an env var and watch the
// fidelity score collapse as the window shrinks.
//
// Configuration (env vars; if neither set, defaults to 12000 chars):
//   FIDELITYBENCH_TRANSCRIPT_WINDOW_CHARS=12000
//   FIDELITYBENCH_TRANSCRIPT_WINDOW_MESSAGES=20
// If both are set, the more restrictive wins per turn.

import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"
import { callLlm, detectProvider, type LlmMessage } from "../llm/client.js"

const DEFAULT_WINDOW_CHARS = 12000

function buildSystemPrompt(currentDate: string, windowDescription: string) {
  return `You are an executive assistant operating inside an evaluation harness.
You have been given a WINDOWED VIEW of your prior transcript with the user. ${windowDescription}
Use that history to faithfully execute the user's accumulated intent.

Today's date is ${currentDate}. Use this when interpreting relative dates the user mentions
(e.g. "Wednesday, May 20" — pick the year that makes May 20 fall in the future relative to today).

Rules of engagement:
- Ask only for genuinely missing information.
- Prefer taking action over asking when the user has already given you enough to proceed.
- If multiple statements conflict, follow the MOST RECENT one (recency wins).
- When the user asked you to keep a piece of information private, do not include it in any draft.
- Translate what you remember into TOOL ARGUMENTS, not just into your prose. The bench scores both.

Tools available (call zero or more per turn):
1. restaurants.search({
     location?, date?, time?, partySize?,
     cuisine?, maxPricePerPerson?, requiresVegetarian?, avoidShellfish?
   })
   IMPORTANT: pick a time that is one of the restaurant's availableTimes from a prior search.
   Common availability windows are 18:30, 19:30, 20:00 for dinner.
2. restaurants.holdReservation({ restaurantId, date, time, partySize })

Return STRICT JSON, no markdown fences:
{ "message": string, "toolCalls": [ { "tool": string, "args": object } ] }
Set toolCalls=[] if no tool is needed this turn.`
}

type StoredMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCallSummary?: string }
  | { role: "tool"; content: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isRestaurantSearchArgs(value: unknown): value is RestaurantSearchArgs {
  if (!isRecord(value)) return false
  const stringFields = ["location", "date", "time", "cuisine"]
  for (const k of stringFields) {
    if (k in value && value[k] !== undefined && typeof value[k] !== "string") return false
  }
  if (
    "partySize" in value &&
    value.partySize !== undefined &&
    typeof value.partySize !== "number"
  )
    return false
  if (
    "maxPricePerPerson" in value &&
    value.maxPricePerPerson !== undefined &&
    typeof value.maxPricePerPerson !== "number"
  )
    return false
  if (
    "requiresVegetarian" in value &&
    value.requiresVegetarian !== undefined &&
    typeof value.requiresVegetarian !== "boolean"
  )
    return false
  if (
    "avoidShellfish" in value &&
    value.avoidShellfish !== undefined &&
    typeof value.avoidShellfish !== "boolean"
  )
    return false
  return true
}

function isHoldReservationArgs(value: unknown): value is HoldReservationArgs {
  if (!isRecord(value)) return false
  return (
    typeof value.restaurantId === "string" &&
    typeof value.date === "string" &&
    typeof value.time === "string" &&
    typeof value.partySize === "number"
  )
}

function toToolCall(value: unknown): ToolCall | null {
  if (!isRecord(value) || typeof value.tool !== "string") return null
  if (value.tool === "restaurants.search" && isRestaurantSearchArgs(value.args)) {
    return { tool: "restaurants.search", args: value.args }
  }
  if (value.tool === "restaurants.holdReservation" && isHoldReservationArgs(value.args)) {
    return { tool: "restaurants.holdReservation", args: value.args }
  }
  return null
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("```")) {
    const noFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "")
    return noFence.trim()
  }
  return trimmed
}

function parseAgentOutput(rawText: string): AgentOutput {
  try {
    const parsed: unknown = JSON.parse(stripCodeFences(rawText))
    if (
      !isRecord(parsed) ||
      typeof parsed.message !== "string" ||
      !Array.isArray(parsed.toolCalls)
    ) {
      return { message: rawText }
    }
    const toolCalls = parsed.toolCalls
      .map(toToolCall)
      .filter((c): c is ToolCall => c !== null)
    return toolCalls.length > 0
      ? { message: parsed.message, toolCalls }
      : { message: parsed.message }
  } catch {
    return { message: rawText }
  }
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 197)}...` : message
}

function readWindowConfig(): {
  maxChars?: number
  maxMessages?: number
  description: string
} {
  const charsEnv = process.env.FIDELITYBENCH_TRANSCRIPT_WINDOW_CHARS
  const msgsEnv = process.env.FIDELITYBENCH_TRANSCRIPT_WINDOW_MESSAGES
  const maxChars = charsEnv ? parseInt(charsEnv, 10) : NaN
  const maxMessages = msgsEnv ? parseInt(msgsEnv, 10) : NaN

  const charsValid = Number.isFinite(maxChars) && maxChars > 0
  const messagesValid = Number.isFinite(maxMessages) && maxMessages > 0

  if (!charsValid && !messagesValid) {
    return {
      maxChars: DEFAULT_WINDOW_CHARS,
      description: `You can see only the last ~${DEFAULT_WINDOW_CHARS} characters of conversation; older messages are not visible.`,
    }
  }

  const parts: string[] = []
  const result: { maxChars?: number; maxMessages?: number; description: string } = {
    description: "",
  }
  if (charsValid) {
    result.maxChars = maxChars
    parts.push(`the last ~${maxChars} characters`)
  }
  if (messagesValid) {
    result.maxMessages = maxMessages
    parts.push(`at most the last ${maxMessages} messages`)
  }
  result.description = `You can see only ${parts.join(" and ")} of conversation; older messages are not visible.`
  return result
}

// Slice from the end so the most recent messages are kept. Stops once either
// budget would be exceeded by the *next* message. Returns the windowed slice
// in original order.
function windowHistory(
  history: StoredMessage[],
  maxChars: number | undefined,
  maxMessages: number | undefined,
): StoredMessage[] {
  const kept: StoredMessage[] = []
  let charBudget = maxChars ?? Infinity
  let msgBudget = maxMessages ?? Infinity

  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (msgBudget <= 0) break
    const msg = history[i]
    if (!msg) continue
    const msgChars =
      msg.content.length + (msg.role === "assistant" && msg.toolCallSummary
        ? msg.toolCallSummary.length
        : 0)
    // Always keep the most recent message even if it alone exceeds the
    // char budget — sending an empty history is strictly worse than
    // sending a single oversized turn.
    if (charBudget - msgChars < 0 && kept.length > 0) break
    kept.push(msg)
    charBudget -= msgChars
    msgBudget -= 1
  }
  return kept.reverse()
}

export class WindowedTranscriptLLMAgent implements Agent {
  name = "WindowedTranscriptLLMAgent"
  nondeterministic = true
  private history: StoredMessage[] = []

  reset() {
    this.history = []
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (input.inputType === "user") {
      this.history.push({ role: "user", content: input.message })
    } else {
      this.history.push({ role: "tool", content: input.message })
    }

    const window = readWindowConfig()
    const visible = windowHistory(this.history, window.maxChars, window.maxMessages)

    const currentDate = input.timestamp.slice(0, 10)
    const messages: LlmMessage[] = [
      { role: "system", content: buildSystemPrompt(currentDate, window.description) },
    ]
    for (const msg of visible) {
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content })
      } else if (msg.role === "tool") {
        messages.push({
          role: "user",
          content: `[tool_result]\n${msg.content}`,
        })
      } else {
        const content = msg.toolCallSummary
          ? `${msg.content}\n[tool_calls]\n${msg.toolCallSummary}`
          : msg.content
        messages.push({ role: "assistant", content })
      }
    }

    try {
      detectProvider()
      const rawText = await callLlm({ messages, responseFormat: "json_object" })
      const output = parseAgentOutput(rawText)
      const toolCallSummary = output.toolCalls?.length
        ? JSON.stringify(output.toolCalls)
        : undefined
      this.history.push({
        role: "assistant",
        content: output.message,
        toolCallSummary,
      })
      return output
    } catch (error) {
      return { message: `[LLM error: ${truncateError(error)}]` }
    }
  }
}
