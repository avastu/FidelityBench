import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"
import { callLlm } from "../llm/client.js"

const SYSTEM_PROMPT = `You are an executive assistant.
You only see the current user message. Respond naturally and helpfully.
If you need information to complete a task, ask the user.
Return strict JSON with this shape:
{ "message": string, "toolCalls": array }

Available tools:
- restaurants.search({location?, date?, time?, partySize?})
- restaurants.holdReservation({restaurantId, date, time, partySize})
Set toolCalls=[] if no tool is needed.`

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 160 ? `${message.slice(0, 157)}...` : message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isRestaurantSearchArgs(value: unknown): value is RestaurantSearchArgs {
  if (!isRecord(value)) return false
  if ("location" in value && value.location !== undefined && typeof value.location !== "string") {
    return false
  }
  if ("date" in value && value.date !== undefined && typeof value.date !== "string") {
    return false
  }
  if ("time" in value && value.time !== undefined && typeof value.time !== "string") {
    return false
  }
  if (
    "partySize" in value &&
    value.partySize !== undefined &&
    typeof value.partySize !== "number"
  ) {
    return false
  }
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
  if (!isRecord(value) || typeof value.tool !== "string") {
    return null
  }

  if (value.tool === "restaurants.search" && isRestaurantSearchArgs(value.args)) {
    return {
      tool: "restaurants.search",
      args: value.args,
    }
  }

  if (
    value.tool === "restaurants.holdReservation" &&
    isHoldReservationArgs(value.args)
  ) {
    return {
      tool: "restaurants.holdReservation",
      args: value.args,
    }
  }

  return null
}

function parseAgentOutput(rawText: string): AgentOutput {
  try {
    const parsed = JSON.parse(stripCodeFences(rawText))
    if (
      !isRecord(parsed) ||
      typeof parsed.message !== "string" ||
      !Array.isArray(parsed.toolCalls)
    ) {
      return { message: rawText }
    }

    const toolCalls = parsed.toolCalls
      .map((toolCall) => toToolCall(toolCall))
      .filter((toolCall): toolCall is ToolCall => toolCall !== null)

    return {
      message: parsed.message,
      toolCalls,
    }
  } catch {
    return { message: rawText }
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
}

export class StatelessLLMAgent implements Agent {
  name = "StatelessLLMAgent"
  nondeterministic = true

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    try {
      const rawText = await callLlm({
        responseFormat: "json_object",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `Current input type: ${input.inputType}
Current message:
${input.message}`,
          },
        ],
      })
      return parseAgentOutput(rawText)
    } catch (error) {
      return { message: `[LLM error: ${truncateError(error)}]` }
    }
  }
}
