// GraphMemoryLLMAgent: an explicit graph-memory baseline.
//
// The runner still sends only the current AgentInput. This agent builds its own
// durable memory by extracting typed nodes and typed edges from each user turn,
// then answers from a retrieved subgraph instead of raw transcript or flat
// memory blocks.

import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  HoldReservationArgs,
  RestaurantSearchArgs,
  ToolCall,
} from "../types.js"
import { callLlm, requireProvider, type LlmMessage } from "../llm/client.js"
import { MemoryGraph, parseGraphExtraction } from "../memory/graphMemory.js"
import { buildResponseSystemPrompt } from "./sharedInstructions.js"

type RetrievalMode = "graph" | "hybrid"

const EXTRACT_SYSTEM = `You extract durable personal-assistant memory into a graph.
The input is ONE new user message plus a current graph excerpt.

Return STRICT JSON only:
{
  "nodes": [
    { "label": string, "type": "person|project|preference|constraint|decision|boundary|pattern|event|location|task|other", "summary": string, "evidence": string }
  ],
  "edges": [
    { "source": string, "target": string, "type": "role_of|preference_of|constraint_on|boundary_about|causes|supports|updates|supersedes|tradeoff|prior_outcome|communication_style|format_preference|related_to", "summary": string, "evidence": string }
  ],
  "observations": [
    { "text": string, "labels": [string] }
  ],
  "deactivateLabels": [string]
}

Rules:
- Extract only user-grounded facts that may matter later.
- Prefer stable labels such as a named person, a project, a timeline constraint, a private concern, or a message-format preference.
- Connect facts with edges. The point is topology, not a bag of facts.
- Preserve privacy boundaries as boundary nodes and boundary_about edges.
- Preserve user-specific patterns, e.g. how the user tends to communicate, decide, react under pressure, or work best.
- If the new message supersedes a prior fact, put the old node label in deactivateLabels, add the new active node, and connect them with a supersedes edge.
- For tradeoffs, create both constraint nodes and a tradeoff edge.
- For action preferences, connect them to the context where they apply.
- Observations are short semantic memory snippets useful for later retrieval.
- Do not answer the user. Do not invent. Empty arrays are valid.`

function respondSystem(currentDate: string, mode: RetrievalMode) {
  const memorySurface =
    mode === "hybrid"
      ? "a retrieved graph plus semantic memory snippets"
      : "a retrieved graph"
  return buildResponseSystemPrompt({
    currentDate,
    contextDescription: `You see ONLY the current input and ${memorySurface}. You do NOT see prior transcript. Your memory is your sole record of accumulated user intent.`,
    memoryUseInstruction:
      "Use the retrieved graph context to faithfully execute the user's accumulated intent; follow active/current nodes and explicit supersedes/updates edges when memories conflict.",
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
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
      .filter((toolCall): toolCall is ToolCall => toolCall !== null)
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

export class GraphBackedLLMAgent implements Agent {
  name = "GraphMemoryLLMAgent"
  nondeterministic = true
  protected readonly memory = new MemoryGraph()
  private lastUserMessage = ""
  private lastToolResult: string | null = null

  constructor(
    name = "GraphMemoryLLMAgent",
    private readonly mode: RetrievalMode = "graph",
  ) {
    this.name = name
  }

  reset() {
    this.memory.reset()
    this.lastUserMessage = ""
    this.lastToolResult = null
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    try {
      requireProvider()
      if (input.inputType === "user") {
        this.lastUserMessage = input.message
        this.lastToolResult = null
        await this.extract(input)
      } else {
        this.lastToolResult = input.message
      }
      return await this.respond(input)
    } catch (error) {
      return { message: `[LLM error: ${truncateError(error)}]` }
    }
  }

  private async extract(input: AgentInput): Promise<void> {
    const currentContext = this.memory.format(
      this.memory.retrieveHybrid(input.message, 36, 18),
      true,
    )
    const messages: LlmMessage[] = [
      { role: "system", content: EXTRACT_SYSTEM },
      {
        role: "user",
        content: `CURRENT GRAPH EXCERPT:\n${currentContext}\n\nNEW USER MESSAGE (${input.timestamp}):\n${input.message}`,
      },
    ]
    const raw = await callLlm({
      messages,
      responseFormat: "json_object",
      temperature: 0,
    })
    this.memory.applyPatch(parseGraphExtraction(raw), input.timestamp)
  }

  private async respond(input: AgentInput): Promise<AgentOutput> {
    const retrievalQuery =
      input.inputType === "user"
        ? input.message
        : `${this.lastUserMessage}\n${this.lastToolResult ?? input.message}`
    const context =
      this.mode === "hybrid"
        ? this.memory.retrieveHybrid(retrievalQuery)
        : this.memory.retrieveGraph(retrievalQuery)
    const memoryText = this.memory.format(context, this.mode === "hybrid")
    const currentBlock =
      input.inputType === "user"
        ? `CURRENT USER MESSAGE:\n${input.message}`
        : `LATEST TOOL RESULT:\n${this.lastToolResult ?? input.message}`
    const currentDate = input.timestamp.slice(0, 10)
    const raw = await callLlm({
      responseFormat: "json_object",
      temperature: 0,
      messages: [
        { role: "system", content: respondSystem(currentDate, this.mode) },
        {
          role: "user",
          content: `MEMORY CONTEXT:\n${memoryText}\n\n${currentBlock}`,
        },
      ],
    })
    return parseAgentOutput(raw)
  }
}

export class GraphMemoryLLMAgent extends GraphBackedLLMAgent {
  constructor() {
    super("GraphMemoryLLMAgent", "graph")
  }
}
