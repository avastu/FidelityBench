// BlockMemoryLLMAgent: a structured-memory LLM agent.
//
// This agent embodies the avocado-style memory architecture:
//   - On every USER message, an LLM extractor classifies the new information
//     into one of five typed blocks (people, preferences, decisions, locations,
//     constraints). Blocks are bounded — each is appended to or rewritten,
//     not concatenated forever.
//   - On every TURN, the response LLM sees the current block contents in its
//     system prompt — NOT the full transcript. This isolates the question
//     "is structured memory better than raw history?" by removing the
//     transcript channel entirely.
//
// Compare to TranscriptLLMAgent (no blocks, full transcript). The contrast
// answers: does structured memory beat dumping the full conversation?
//
// This is NOT a wrap of Avocado's actual code — it's a clean-room
// re-implementation of the same architectural shape. See README "Architecture
// comparison" for what this measures and what it doesn't.

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

const BLOCK_NAMES = [
  "people",
  "preferences",
  "decisions",
  "locations",
  "constraints",
] as const
type BlockName = (typeof BLOCK_NAMES)[number]
type Blocks = Record<BlockName, string[]>

const EMPTY_BLOCKS: Blocks = {
  people: [],
  preferences: [],
  decisions: [],
  locations: [],
  constraints: [],
}

const EXTRACT_SYSTEM = `You are a memory extractor for a personal assistant.
Given a NEW user message and the CURRENT memory blocks, output a STRICT JSON
patch that says what should change in memory. Each block is a SHORT BULLETED
LIST of facts.

Rules:
- preferences = stable user preferences (e.g. preferred timing, format, style, category, or option)
- people = facts about specific people the user mentions (e.g. role, need, preference, boundary, or relevant context)
- decisions = explicit decisions the user has made or settled on (e.g. chose one option over another)
- locations = locations the user has chosen or pinned (e.g. neighborhood, city, venue, or remote/in-person setting)
- constraints = explicit boundaries, no-tells, budget caps, time windows, deadlines, or privacy limits

If the new message SUPERSEDES an earlier item:
- DELETE the old item by listing the EXACT old string in "remove[block]"
- ADD the new item in "add[block]"

If a fact does not fit, omit it. Do not invent. Do not guess.

Return STRICT JSON, no markdown:
{
  "add":    { "people": [], "preferences": [], "decisions": [], "locations": [], "constraints": [] },
  "remove": { "people": [], "preferences": [], "decisions": [], "locations": [], "constraints": [] }
}`

function respondSystem(currentDate: string) {
  return buildResponseSystemPrompt({
    currentDate,
    contextDescription:
      "You see ONLY the current input and your structured memory blocks. You do NOT see prior transcript. Your memory is your sole record of accumulated user intent.",
    memoryUseInstruction:
      "Use the structured memory blocks to faithfully execute the user's accumulated intent.",
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  }
  return trimmed
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string")
}

function parseExtraction(rawText: string): { add: Partial<Blocks>; remove: Partial<Blocks> } {
  try {
    const parsed: unknown = JSON.parse(stripCodeFences(rawText))
    if (!isRecord(parsed)) return { add: {}, remove: {} }
    const out: { add: Partial<Blocks>; remove: Partial<Blocks> } = { add: {}, remove: {} }
    for (const block of BLOCK_NAMES) {
      const addBlock = isRecord(parsed.add) ? parsed.add[block] : undefined
      const removeBlock = isRecord(parsed.remove) ? parsed.remove[block] : undefined
      if (isStringArray(addBlock)) out.add[block] = addBlock
      if (isStringArray(removeBlock)) out.remove[block] = removeBlock
    }
    return out
  } catch {
    return { add: {}, remove: {} }
  }
}

function applyPatch(blocks: Blocks, patch: { add: Partial<Blocks>; remove: Partial<Blocks> }): Blocks {
  const next: Blocks = { ...blocks }
  for (const block of BLOCK_NAMES) {
    const removals = new Set(patch.remove[block] ?? [])
    const surviving = blocks[block].filter((item) => !removals.has(item))
    const additions = (patch.add[block] ?? []).filter((item) => !surviving.includes(item))
    next[block] = [...surviving, ...additions]
  }
  return next
}

function blocksToText(blocks: Blocks): string {
  const lines: string[] = []
  for (const block of BLOCK_NAMES) {
    const items = blocks[block]
    lines.push(`## ${block}`)
    if (items.length === 0) lines.push("(empty)")
    for (const item of items) lines.push(`- ${item}`)
    lines.push("")
  }
  return lines.join("\n")
}

function isRestaurantSearchArgs(value: unknown): value is RestaurantSearchArgs {
  if (!isRecord(value)) return false
  for (const k of ["location", "date", "time", "cuisine"]) {
    if (k in value && value[k] !== undefined && typeof value[k] !== "string") return false
  }
  for (const k of ["partySize", "maxPricePerPerson"]) {
    if (k in value && value[k] !== undefined && typeof value[k] !== "number") return false
  }
  for (const k of ["requiresVegetarian", "avoidShellfish"]) {
    if (k in value && value[k] !== undefined && typeof value[k] !== "boolean") return false
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
  const msg = error instanceof Error ? error.message : String(error)
  return msg.length > 200 ? `${msg.slice(0, 197)}...` : msg
}

export class BlockMemoryLLMAgent implements Agent {
  name = "BlockMemoryLLMAgent"
  nondeterministic = true
  private blocks: Blocks = { ...EMPTY_BLOCKS, people: [], preferences: [], decisions: [], locations: [], constraints: [] }
  // Latest tool result is the only "transcript" the response LLM sees besides
  // the current user message and the blocks. This lets it close the search →
  // hold loop without exposing prior turns.
  private lastToolResult: string | null = null

  reset() {
    this.blocks = { people: [], preferences: [], decisions: [], locations: [], constraints: [] }
    this.lastToolResult = null
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    try {
      requireProvider()
      if (input.inputType === "user") {
        await this.extract(input.message)
        this.lastToolResult = null
      } else {
        this.lastToolResult = input.message
      }
      return await this.respond(input)
    } catch (error) {
      return { message: `[LLM error: ${truncateError(error)}]` }
    }
  }

  private async extract(userMessage: string): Promise<void> {
    const messages: LlmMessage[] = [
      { role: "system", content: EXTRACT_SYSTEM },
      {
        role: "user",
        content: `CURRENT MEMORY:\n${blocksToText(this.blocks)}\n\nNEW USER MESSAGE:\n${userMessage}`,
      },
    ]
    const raw = await callLlm({ messages, responseFormat: "json_object" })
    const patch = parseExtraction(raw)
    this.blocks = applyPatch(this.blocks, patch)
  }

  private async respond(input: AgentInput): Promise<AgentOutput> {
    const memoryView = blocksToText(this.blocks)
    const userBlock =
      input.inputType === "user"
        ? `CURRENT USER MESSAGE:\n${input.message}`
        : `LATEST TOOL RESULT (act on this — do NOT summarize it back to the user; choose a restaurant and call holdReservation if appropriate):\n${this.lastToolResult ?? input.message}`

    const currentDate = input.timestamp.slice(0, 10)
    const messages: LlmMessage[] = [
      { role: "system", content: respondSystem(currentDate) },
      {
        role: "user",
        content: `MEMORY (your only record of past turns):\n${memoryView}\n\n${userBlock}`,
      },
    ]
    const raw = await callLlm({ messages, responseFormat: "json_object" })
    return parseAgentOutput(raw)
  }
}
