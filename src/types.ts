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

export type RecallBurdenCategory =
  | "cuisine"
  | "budget"
  | "dietary"
  | "location"
  | "time"

export type RecallBurdenEvent = {
  category: RecallBurdenCategory
  message: string
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
}
