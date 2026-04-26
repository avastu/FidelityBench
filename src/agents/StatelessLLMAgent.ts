import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"

declare const process: { env: Record<string, string | undefined> }

const DEFAULT_MODEL = process.env.FIDELITYBENCH_MODEL ?? "gpt-4o-mini"

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

function extractTextContent(content: string | null): string {
  return typeof content === "string" ? content : ""
}

function parseAgentOutput(rawText: string): AgentOutput {
  try {
    const parsed = JSON.parse(rawText)
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

async function createOpenAIClient() {
  const moduleName = ["open", "ai"].join("")
  const importedModule = await import(moduleName)
  const OpenAI = importedModule.default
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export class StatelessLLMAgent implements Agent {
  name = "StatelessLLMAgent"
  private readonly model = DEFAULT_MODEL

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    try {
      const client = await createOpenAIClient()
      const completion = await client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
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

      const rawText = extractTextContent(completion.choices[0]?.message?.content ?? null)
      return parseAgentOutput(rawText)
    } catch (error) {
      return { message: `[LLM error: ${truncateError(error)}]` }
    }
  }
}
