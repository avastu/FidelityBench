import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"
import { clearMemory, readMemory, writeMemory } from "../memory/fileMemory.js"

declare const process: { env: Record<string, string | undefined> }

const DEFAULT_MODEL = process.env.FIDELITYBENCH_MODEL ?? "gpt-4o-mini"
const DEFAULT_USER_ID = "eval_user_001"

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

function extractTextContent(content: string | null): string {
  return typeof content === "string" ? content : ""
}

async function createOpenAIClient() {
  const moduleName = ["open", "ai"].join("")
  const importedModule = await import(moduleName)
  const OpenAI = importedModule.default
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export class FileMemoryLLMAgent implements Agent {
  name = "FileMemoryLLMAgent"
  nondeterministic = true
  private readonly model = DEFAULT_MODEL
  private userId = DEFAULT_USER_ID

  reset() {
    clearMemory(this.userId)
    if (this.userId !== DEFAULT_USER_ID) {
      clearMemory(DEFAULT_USER_ID)
    }
    this.userId = DEFAULT_USER_ID
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    this.userId = input.userId || this.userId

    if (input.inputType === "user") {
      const memoryUpdate = await this.updateMemory(input.message)
      if (!memoryUpdate.ok) {
        return memoryUpdate.output
      }
    }

    return this.respond(input)
  }

  private async updateMemory(
    message: string,
  ): Promise<{ ok: true } | { ok: false; output: AgentOutput }> {
    const existingMemory = readMemory(this.userId)

    try {
      const client = await createOpenAIClient()
      const completion = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: `You maintain memory for an executive assistant.
Update the memory based on the new user message.
Keep only information that may matter later:
- stable preferences
- constraints
- decisions
- people and their relevant needs/preferences
- locations
- budgets
- open loops
- privacy/boundary notes
Do not store irrelevant chatter.
Existing memory:
${existingMemory}
New user message:
${message}
Return updated memory as concise markdown.`,
          },
        ],
      })

      const updatedMemory = extractTextContent(completion.choices[0]?.message?.content ?? null)
      writeMemory(this.userId, updatedMemory.trim())
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        output: { message: `[LLM error: ${truncateError(error)}]` },
      }
    }
  }

  private async respond(input: AgentInput): Promise<AgentOutput> {
    const savedMemory = readMemory(this.userId)

    try {
      const client = await createOpenAIClient()
      const completion = await client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an executive assistant.
You receive only the current user message and your saved memory.
Use memory to avoid making the user repeat known information.
Ask clarifying questions only for genuinely missing information.
If tool use is appropriate, return tool calls.
Saved memory:
${savedMemory}
Current input type:
${input.inputType}
Current message:
${input.message}
Available tools:
1. restaurants.search(args: { location?, date?, time?, partySize? })
2. restaurants.holdReservation(args: { restaurantId, date, time, partySize })
Return strict JSON:
{
  "message": string,
  "toolCalls": [
    {
      "tool": "restaurants.search" | "restaurants.holdReservation",
      "args": object
    }
  ]
}`,
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
