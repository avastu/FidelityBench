// Temporal supersession: tests recency-over-retention.
// The user changes their mind about cuisine partway through. A faithful
// agent must follow the LATEST stated cuisine (Mexican), not the earliest (Italian).
// "Zombie intent" — booking the superseded cuisine — is the failure mode.

import { RESTAURANTS } from "../src/tools.js"
import type {
  EvaluationResult,
  HoldReservationArgs,
  IntentDimensionResult,
  RecallBurdenCategory,
  RecallBurdenEvent,
  Scenario,
  ScenarioBundle,
  ScenarioJudgeInput,
  SimulatedUserResultV2,
  TranscriptEvent,
} from "../src/types.js"

export const temporalSupersessionScenario: Scenario = {
  id: "temporal_supersession_001",
  title: "Plan the team lunch — recency wins",
  timeline: [
    {
      timestamp: "2026-05-01T09:00:00-07:00",
      message:
        "Let's plan a Monday team lunch next week. Italian sounds good — like Bella Tavola or somewhere similar.",
    },
    {
      timestamp: "2026-05-02T11:00:00-07:00",
      message:
        "Priya is vegetarian, so wherever we go, make sure she has real options.",
    },
    {
      timestamp: "2026-05-03T14:00:00-07:00",
      message:
        "Actually, scratch the Italian idea — the team's been craving Mexican lately. Let's go in that direction instead.",
    },
    {
      timestamp: "2026-05-04T10:00:00-07:00",
      message: "Around $50/person ceiling. Mission district works.",
    },
  ],
  finalTask: {
    timestamp: "2026-05-08T10:00:00-07:00",
    message: "Can you book the team lunch for Monday, May 11?",
  },
}

// Sentence-level question detection (same approach as dinner sim user).
function questionPortion(message: string): string {
  const sentences = message.split(/(?<=[.!?])\s+/)
  return sentences.filter((s) => s.trim().endsWith("?")).join(" ")
}

const PATTERNS: Record<RecallBurdenCategory, RegExp[]> = {
  cuisine: [
    /what (cuisine|kind of food|type of food)/i,
    /any preference.*(cuisine|food)/i,
    /italian or mexican/i,
  ],
  budget: [/what.*budget/i, /price range/i, /how much.*spend/i, /budget.*for/i],
  dietary: [
    /(any|what|other).*dietary/i,
    /(any|what).*allerg/i,
    /(any|other|what).*(vegetarian|vegan)/i,
    /food restrictions/i,
  ],
  location: [
    /where.*(look|search|book|reserve)/i,
    /what.*neighborhood/i,
    /which area/i,
    /what.*location/i,
  ],
  time: [/what time/i, /when.*lunch/i, /preferred time/i],
}

const PARTY_SIZE_PATTERNS = [
  /party size/i,
  /how many people/i,
  /number of people/i,
  /for how many/i,
  /how many.*attending/i,
]

function matchAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message))
}

export const temporalSupersessionSimulatedUser = (
  assistantMessage: string,
): SimulatedUserResultV2 => {
  const recallBurdenEvents: RecallBurdenEvent[] = []
  const questionText = questionPortion(assistantMessage)
  const categories = Object.keys(PATTERNS) as RecallBurdenCategory[]
  for (const category of categories) {
    if (questionText && matchAny(questionText, PATTERNS[category])) {
      recallBurdenEvents.push({ category, message: assistantMessage })
    }
  }

  const askedPartySize = questionText
    ? matchAny(questionText, PARTY_SIZE_PATTERNS)
    : false
  const askedRequiredFields = askedPartySize ? ["partySize"] : []

  if (askedPartySize) {
    return {
      shouldRespond: true,
      response: "6 of us.",
      recallBurdenEvents,
      askedRequiredFields,
    }
  }

  if (recallBurdenEvents.length > 0) {
    const responses: string[] = []
    for (const event of recallBurdenEvents) {
      if (event.category === "cuisine") {
        responses.push(
          "Mexican — I changed my mind from Italian a few days ago.",
        )
      }
      if (event.category === "budget") responses.push("Around $50/person.")
      if (event.category === "dietary") {
        responses.push("Priya is vegetarian.")
      }
      if (event.category === "location") {
        responses.push("Mission district.")
      }
      if (event.category === "time") responses.push("Around lunchtime.")
    }
    return {
      shouldRespond: true,
      response: responses.join(" "),
      recallBurdenEvents,
      askedRequiredFields,
    }
  }

  return { shouldRespond: false, recallBurdenEvents, askedRequiredFields }
}

function getFinalAssistantMessage(transcript: TranscriptEvent[]): string {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = transcript[index]
    if (event?.type === "assistant") return event.message
  }
  return ""
}

function getHeldReservation(
  transcript: TranscriptEvent[],
): HoldReservationArgs | undefined {
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.holdReservation") return call.args
    }
  }
  return undefined
}

function getSuccessfulHold(
  transcript: TranscriptEvent[],
): HoldReservationArgs | undefined {
  for (const event of transcript) {
    if (event.type !== "tool_result") continue
    if (event.result.tool !== "restaurants.holdReservation") continue
    if (event.result.result.success) return event.result.args
  }
  return undefined
}

function searchedAndHeld(transcript: TranscriptEvent[]) {
  let searched = false
  let held = false
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.search") searched = true
      if (call.tool === "restaurants.holdReservation") held = true
    }
  }
  return { searched, held }
}

export const temporalSupersessionJudge = (
  input: ScenarioJudgeInput,
): EvaluationResult => {
  const finalAssistantMessage = getFinalAssistantMessage(input.transcript)
  const heldReservation = getHeldReservation(input.transcript)
  const successfulHold = getSuccessfulHold(input.transcript)
  // Fidelity scoring uses the SUCCESSFUL hold only — calling holdReservation
  // for "the right" restaurant at an unavailable time should not earn fidelity credit.
  const selectedRestaurantId = successfulHold?.restaurantId
  const selectedRestaurant = RESTAURANTS.find(
    (r) => r.id === selectedRestaurantId,
  )

  const dimensions: IntentDimensionResult[] = []
  const notes: string[] = []

  // 1) Cuisine recency — Mexican (latest) is correct, Italian (superseded) is "zombie intent"
  // CRITICAL: this dimension is only honored if the agent did NOT need to ask the user
  // for the cuisine. Otherwise we'd be "laundering memory through the simulated user" —
  // a stateless agent that asks "what cuisine?" and gets told "Mexican" would otherwise
  // get full credit despite having zero retained intent.
  const askedCuisine = input.recallBurdenEvents.some((e) => e.category === "cuisine")
  let cuisineHonored = false
  let cuisineEvidence = "no selection"
  if (askedCuisine) {
    cuisineEvidence = "agent asked the user for cuisine — credit withheld (memory laundering)"
    notes.push(
      "MEMORY LAUNDERING: agent asked the user for cuisine; selection was not driven by retained intent.",
    )
  } else if (selectedRestaurant?.cuisine === "Mexican") {
    cuisineHonored = true
    cuisineEvidence = "selected Mexican (latest stated cuisine) without asking"
  } else if (selectedRestaurant?.cuisine === "Italian") {
    cuisineEvidence = `selected Italian (${selectedRestaurantId}) — SUPERSEDED on day 3`
    notes.push("ZOMBIE INTENT: agent honored Italian, but user revised to Mexican on day 3.")
  } else if (selectedRestaurant) {
    cuisineEvidence = `selected ${selectedRestaurant.cuisine} — neither Italian nor Mexican`
  }
  dimensions.push({
    id: "cuisine_recency",
    description: "Honors LATEST cuisine choice (Mexican over Italian) WITHOUT asking",
    honored: cuisineHonored,
    weight: 12,
    evidence: cuisineEvidence,
  })

  // 2) Vegetarian-friendly: rest_006 best (strong veggie), rest_005 OK, rest_007 fail
  // Memory-laundering gate applies here too: if the agent asked, credit is withheld.
  const askedDietary = input.recallBurdenEvents.some((e) => e.category === "dietary")
  const vegetarianFriendlyIds = new Set(["rest_005", "rest_006"])
  const vegMatch = selectedRestaurantId
    ? vegetarianFriendlyIds.has(selectedRestaurantId)
    : false
  const vegetarianHonored = !askedDietary && vegMatch
  dimensions.push({
    id: "dietary_vegetarian",
    description: "Honors Priya's vegetarian needs WITHOUT asking",
    honored: vegetarianHonored,
    weight: 8,
    evidence: askedDietary
      ? "agent asked the user for dietary needs — credit withheld"
      : vegetarianHonored
        ? `selected ${selectedRestaurantId} (vegetarian-friendly) without asking`
        : `selected ${selectedRestaurantId ?? "none"} — fails vegetarian constraint`,
  })

  // 3) Budget: <= $50/person
  const askedBudget = input.recallBurdenEvents.some((e) => e.category === "budget")
  const budgetMatch = selectedRestaurant
    ? selectedRestaurant.priceEstimatePerPerson <= 50
    : false
  const budgetHonored = !askedBudget && budgetMatch
  dimensions.push({
    id: "budget_50",
    description: "Within $50/person ceiling WITHOUT asking",
    honored: budgetHonored,
    weight: 8,
    evidence: askedBudget
      ? "agent asked the user for budget — credit withheld"
      : selectedRestaurant
        ? `selected $${selectedRestaurant.priceEstimatePerPerson}/person`
        : "no selection",
  })

  // 4) Location: Mission
  const askedLocation = input.recallBurdenEvents.some((e) => e.category === "location")
  const locationMatch = selectedRestaurant?.neighborhood === "Mission"
  const locationHonored = !askedLocation && locationMatch
  dimensions.push({
    id: "location_mission",
    description: "Honors Mission district WITHOUT asking",
    honored: locationHonored,
    weight: 7,
    evidence: askedLocation
      ? "agent asked the user for location — credit withheld"
      : selectedRestaurant
        ? `${selectedRestaurant.neighborhood}`
        : "no selection",
  })

  // v0.6: query fidelity — did the agent translate memory into search args?
  let queryScore = 0
  const queryParts: string[] = []
  let firstSearchArgs:
    | import("../src/types.js").RestaurantSearchArgs
    | undefined
  for (const event of input.transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.search") {
        firstSearchArgs = call.args
        break
      }
    }
    if (firstSearchArgs) break
  }
  if (firstSearchArgs) {
    if (firstSearchArgs.location?.toLowerCase().includes("mission")) {
      queryScore += 2
      queryParts.push("location=Mission ✓")
    } else queryParts.push(`location=${firstSearchArgs.location ?? "(unset)"} ✗`)
    if (firstSearchArgs.cuisine?.toLowerCase() === "mexican") {
      queryScore += 2
      queryParts.push("cuisine=Mexican ✓")
    } else queryParts.push(`cuisine=${firstSearchArgs.cuisine ?? "(unset)"} ✗`)
    if (
      firstSearchArgs.maxPricePerPerson !== undefined &&
      firstSearchArgs.maxPricePerPerson <= 50 &&
      firstSearchArgs.maxPricePerPerson >= 25
    ) {
      queryScore += 2
      queryParts.push(`maxPrice=${firstSearchArgs.maxPricePerPerson} ✓`)
    } else queryParts.push(`maxPrice=${firstSearchArgs.maxPricePerPerson ?? "(unset)"} ✗`)
    if (firstSearchArgs.requiresVegetarian === true) {
      queryScore += 2
      queryParts.push("requiresVegetarian=true ✓")
    } else queryParts.push("requiresVegetarian=(unset) ✗")
  } else {
    queryParts.push("no restaurants.search call")
  }
  dimensions.push({
    id: "query_fidelity",
    description: "Translates memory into restaurants.search args",
    honored: queryScore >= 6,
    weight: 8,
    evidence: queryParts.join(", "),
  })

  // Intent fidelity score: weighted sum of honored dimensions PLUS the query score
  // (which earns partial credit per arg, not just on/off).
  const intentFidelity =
    dimensions
      .filter((d) => d.id !== "query_fidelity")
      .reduce((sum, dim) => sum + (dim.honored ? dim.weight : 0), 0) + queryScore

  // Task success
  let taskSuccess = 0
  if (successfulHold && selectedRestaurant?.cuisine === "Mexican") {
    taskSuccess = 30
  } else if (successfulHold) {
    taskSuccess = 12
  }

  // Recall burden: 20 - 5 per unique category
  const uniqueRecallCategories = new Set(
    input.recallBurdenEvents.map((e) => e.category),
  )
  let recallBurden = Math.max(0, 20 - uniqueRecallCategories.size * 5)

  // Clarification quality
  const askedPartySize = input.askedRequiredFields.has("partySize")
  let clarificationQuality = 0
  if (askedPartySize && uniqueRecallCategories.size === 0) clarificationQuality = 10
  else if (askedPartySize && uniqueRecallCategories.size === 1) clarificationQuality = 6
  else if (askedPartySize && uniqueRecallCategories.size > 1) clarificationQuality = 3
  else if (!askedPartySize && heldReservation) clarificationQuality = 4

  // Tool use efficiency
  const { searched, held } = searchedAndHeld(input.transcript)
  const toolUseEfficiency = searched && held ? 5 : searched ? 3 : 0

  // Engagement gate: an agent that did neither (no hold, no ask, no search) gets
  // no free recall-burden credit — silence is not fidelity.
  const engaged = !!heldReservation || askedPartySize || searched
  if (!engaged) {
    recallBurden = 0
    notes.push("NO ENGAGEMENT: agent did not search, hold, or ask for the missing field.")
  }

  const totalScore =
    taskSuccess +
    intentFidelity +
    recallBurden +
    clarificationQuality +
    toolUseEfficiency

  if (
    finalAssistantMessage.length > 0 &&
    /italian/i.test(finalAssistantMessage) &&
    selectedRestaurant?.cuisine !== "Mexican"
  ) {
    notes.push(
      "Final assistant message mentioned Italian but did not select Mexican — possible stale-context drift.",
    )
  }

  return {
    agentName: input.agentName,
    scenarioId: input.scenarioId,
    totalScore,
    taskSuccess,
    intentFidelity,
    recallBurden,
    clarificationQuality,
    toolUseEfficiency,
    recallBurdenEvents: input.recallBurdenEvents,
    selectedRestaurantId,
    heldReservation,
    transcript: input.transcript,
    intentDimensionResults: dimensions,
    notes,
  }
}

export const temporalSupersessionBundle: ScenarioBundle = {
  scenario: temporalSupersessionScenario,
  simulatedUser: temporalSupersessionSimulatedUser,
  judge: temporalSupersessionJudge,
  requiredFields: ["partySize"],
}
