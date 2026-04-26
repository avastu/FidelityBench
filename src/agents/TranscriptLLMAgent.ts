import OpenAI from "openai"
import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"

const DEFAULT_MODEL = process.env.FIDELITYBENCH_MODEL ?? "gpt-4o-mini"

const SYSTEM_PROMPT = `You are an executive assistant.
You are given the FULL prior transcript of your conversation with the user (so the user does not have to repeat themselves).
Use that history to faithfully execute the user's accumulated intent.
Ask only for genuinely missing information.
Prefer taking action over asking when the user has already given you enough to proceed.
If multiple statements conflict, follow the MOST RECENT one (recency wins).
Tools available:
- restaurants.search({ location?, date?, time?, partySize? })
- restaurants.holdReservation({ restaurantId, date, time, partySize })
Return strict JSON: { "message": string, "toolCalls": Array<{ "tool": string, "args": object }> }
Set toolCalls=[] if no tool is needed.`

type StoredMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCallSummary?: string }
  | { role: "tool"; content: string }

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 160 ? `${message.slice(0, 157)}...` : message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isRestaurantSearchArgs(value: unknown): value is RestaurantSearchArgs {
  if (!isRecord(value)) return false
  if ("location" in value && value.location !== undefined && typeof value.location !== "string") return false
  if ("date" in value && value.date !== undefined && typeof value.date !== "string") return false
  if ("time" in value && value.time !== undefined && typeof value.time !== "string") return false
  if ("partySize" in value && value.partySize !== undefined && typeof value.partySize !== "number") return false
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

function parseAgentOutput(rawText: string): AgentOutput {
  try {
    const parsed: unknown = JSON.parse(rawText)
    if (!isRecord(parsed) || typeof parsed.message !== "string" || !Array.isArray(parsed.toolCalls)) {
      return { message: rawText }
    }
    const toolCalls = parsed.toolCalls
      .map(toToolCall)
      .filter((c): c is ToolCall => c !== null)
    return { message: parsed.message, toolCalls }
  } catch {
    return { message: rawText }
  }
}

export class TranscriptLLMAgent implements Agent {
  name = "TranscriptLLMAgent"
  private readonly model = DEFAULT_MODEL
  private history: StoredMessage[] = []
  private client: OpenAI | null = null

  reset() {
    this.history = []
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    }
    return this.client
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (input.inputType === "user") {
      this.history.push({ role: "user", content: input.message })
    } else {
      this.history.push({ role: "tool", content: input.message })
    }

    try {
      const messages: Array<{
        role: "system" | "user" | "assistant"
        content: string
      }> = [{ role: "system", content: SYSTEM_PROMPT }]

      for (const msg of this.history) {
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

      const completion = await this.getClient().chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages,
      })

      const rawText = completion.choices[0]?.message?.content ?? ""
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
