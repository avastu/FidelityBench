// TranscriptLLMAgent: the empirical "transcript baseline" — feeds the full
// prior transcript to a frontier LLM at every turn. This is the answer to
// "what if 128k context just solves it?" Without this baseline we cannot tell
// whether structured memory architectures actually beat naive history retention.
//
// As of v1.0 this is the public CEILING agent. OracleAgent is hand-coded and
// only useful for rubric sanity-checking. If TranscriptLLMAgent does not
// achieve high scores here, the bench's targets are unreachable for any
// real LLM-based agent and the rubrics need rebalancing.

import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"
import { callLlm, requireProvider, type LlmMessage } from "../llm/client.js"
import { buildResponseSystemPrompt } from "./sharedInstructions.js"

function buildSystemPrompt(currentDate: string) {
  return buildResponseSystemPrompt({
    currentDate,
    contextDescription:
      "You have been given the FULL prior transcript of your conversation with the user, so the user does not have to repeat themselves.",
    memoryUseInstruction:
      "Use the visible transcript to faithfully execute the user's accumulated intent.",
  })
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
  // The model occasionally wraps JSON in ```json ... ``` despite being told not to.
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

export class TranscriptLLMAgent implements Agent {
  name = "TranscriptLLMAgent"
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

    const currentDate = input.timestamp.slice(0, 10)
    const messages: LlmMessage[] = [
      { role: "system", content: buildSystemPrompt(currentDate) },
    ]
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

    try {
      requireProvider()
      const rawText = await callLlm({
        messages,
        expectedFormat: "json_object",
        label: `${this.name}.respond`,
      })
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
