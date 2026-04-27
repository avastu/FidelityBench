export type InputType = "user" | "tool_result"

export type AgentInput = {
  runId: string
  scenarioId: string
  userId: string
  timestamp: string
  inputType: InputType
  message: string
}

export type RestaurantSearchArgs = {
  location?: string
  date?: string
  time?: string
  partySize?: number
  // v0.6: search now actually filters. Agents that pass these args demonstrate
  // they retained user intent at the QUERY level, not just at the selection level.
  cuisine?: string
  maxPricePerPerson?: number
  requiresVegetarian?: boolean
  avoidShellfish?: boolean
}

export type HoldReservationArgs = {
  restaurantId: string
  date: string
  time: string
  partySize: number
}

export type ToolCall =
  | {
      tool: "restaurants.search"
      args: RestaurantSearchArgs
    }
  | {
      tool: "restaurants.holdReservation"
      args: HoldReservationArgs
    }

export type AgentOutput = {
  message: string
  toolCalls?: ToolCall[]
}

export type Restaurant = {
  id: string
  name: string
  cuisine: string
  neighborhood: string
  priceEstimatePerPerson: number
  availableTimes: string[]
  description: string
  menuHighlights: string[]
  dietaryNotes: string
}

export type SearchToolResult = {
  tool: "restaurants.search"
  args: RestaurantSearchArgs
  result: Restaurant[]
}

export type HoldToolResult = {
  tool: "restaurants.holdReservation"
  args: HoldReservationArgs
  result: {
    success: boolean
    reservationId?: string
    message: string
  }
}

export type ToolResult = SearchToolResult | HoldToolResult

export type TimelineEvent = {
  timestamp: string
  message: string
}

export type Scenario = {
  id: string
  title: string
  timeline: TimelineEvent[]
  finalTask: TimelineEvent
}

// A scenario-specific simulated user. Returns the next user response (if any),
// any recall-burden events triggered by the assistant message, and the set of
// "required field" clarifications it recognized (e.g. ["partySize"] for dinner).
export type SimulatedUserResultV2 = {
  shouldRespond: boolean
  response?: string
  recallBurdenEvents: RecallBurdenEvent[]
  askedRequiredFields: string[]
}
export type SimulatedUserFn = (assistantMessage: string) => SimulatedUserResultV2

export type IntentDimensionResult = {
  id: string
  description: string
  honored: boolean
  weight: number
  evidence: string
  // Indices into EvaluationResult.transcript that explain the dimension.
  // All optional; judges populate whichever apply.
  //   originTurnIndex   — user turn where this intent was first established
  //   pivotTurnIndex    — user turn that updated/superseded that intent
  //   failureTurnIndex  — assistant turn that violated (or honored) the intent
  // For dimensions evaluated against the held reservation, failureTurnIndex
  // points at the assistant turn emitting the hold's toolCall.
  originTurnIndex?: number
  pivotTurnIndex?: number
  failureTurnIndex?: number
}

export type ScenarioJudgeInput = {
  agentName: string
  scenarioId: string
  transcript: TranscriptEvent[]
  recallBurdenEvents: RecallBurdenEvent[]
  askedRequiredFields: Set<string>
}
export type ScenarioJudge = (input: ScenarioJudgeInput) => EvaluationResult

// "action" scenarios test execution-fidelity (the agent must DO something —
// book a restaurant, draft a document). "reflection" scenarios test
// reflection-fidelity (the agent must FAITHFULLY MIRROR what the user said
// without veering into advice, fixing, or projection). Companion-style
// agents will collapse to 0 on action scenarios by design — the family
// split prevents reading that as a fidelity failure.
export type ScenarioFamily = "action" | "reflection"

export type ScenarioBundle = {
  scenario: Scenario
  simulatedUser: SimulatedUserFn
  judge: ScenarioJudge
  requiredFields: string[]
  family: ScenarioFamily
  // Maximum total score this scenario can award. Surfaced in the report so
  // readers can see "Total 102/110" rather than just "Total 102". Each
  // scenario sets its own ceiling because intent dimensions vary by scenario.
  maxScore: number
  // Per-metric ceilings, optional. If unset, report falls back to defaults.
  maxIntentFidelity?: number
  // One-line summary of what this scenario probes; printed in the report.
  probes?: string
}

export type TranscriptEvent =
  | {
      type: "user"
      timestamp: string
      message: string
    }
  | {
      type: "assistant"
      timestamp: string
      agentName: string
      message: string
      toolCalls?: ToolCall[]
    }
  | {
      type: "tool_result"
      timestamp: string
      result: ToolResult
    }

// Recall-burden categories are scenario-local. Each scenario defines its own
// vocabulary (e.g. cuisine/budget/time for dinner; alex_identity/private_boundary
// for alex_pushback). The type is a plain string alias so adding a scenario
// doesn't require editing this file. The report renders the category labels
// verbatim, so pick names that read clearly.
export type RecallBurdenCategory = string

export type RecallBurdenEvent = {
  category: RecallBurdenCategory
  message: string
  // Index into EvaluationResult.transcript identifying the assistant turn
  // that asked the recall question. Stamped by the runner; simulated users
  // don't know the turn index. Optional for backward-compat.
  turnIndex?: number
}

export type EvaluationResult = {
  agentName: string
  scenarioId: string
  totalScore: number
  taskSuccess: number
  intentFidelity: number
  recallBurden: number
  clarificationQuality: number
  toolUseEfficiency: number
  recallBurdenEvents: RecallBurdenEvent[]
  selectedRestaurantId?: string
  heldReservation?: HoldReservationArgs
  transcript: TranscriptEvent[]
  // Per-dimension diagnosis: which intent dimensions did the agent honor or violate?
  intentDimensionResults?: IntentDimensionResult[]
  // Free-form notes the judge wants surfaced in the report (e.g. "zombie intent").
  notes?: string[]
  // Set by the runner when the agent did not produce a valid benchmark attempt
  // (for example, an LLM provider error surfaced as the assistant message).
  invalidReason?: string
  // Set by the runner when this result represents one trial out of many
  // (--trials N). The display result for that agent×scenario will be the
  // averaged result; per-trial results are kept in the JSON output for
  // post-hoc analysis.
  trialIndex?: number
}

// Aggregated across N trials of the same agent on the same scenario.
// Per-metric mean + sample stddev. Other rich fields (transcript, dimensions)
// are taken from the FIRST trial — they're meant for qualitative inspection,
// not statistics.
export type AggregatedResult = EvaluationResult & {
  trials: number
  stddev: {
    totalScore: number
    taskSuccess: number
    intentFidelity: number
    recallBurden: number
    clarificationQuality: number
    toolUseEfficiency: number
  }
}
