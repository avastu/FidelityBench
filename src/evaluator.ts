import { RESTAURANTS } from "./tools.js"
import type {
  EvaluationResult,
  HoldReservationArgs,
  IntentDimensionResult,
  RecallBurdenEvent,
  RestaurantSearchArgs,
  ScenarioJudgeInput,
  TranscriptEvent,
} from "./types.js"

// v0.6: extract the args of the FIRST restaurants.search call. The agent's query
// is itself an expression of intent — passing maxPricePerPerson=80 means the agent
// remembered the budget at query time, not just at selection time.
export function getFirstSearchArgs(
  transcript: TranscriptEvent[],
): RestaurantSearchArgs | undefined {
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.search") return call.args
    }
  }
  return undefined
}

function findFirstSearchTurnIndex(
  transcript: TranscriptEvent[],
): number | undefined {
  for (let i = 0; i < transcript.length; i += 1) {
    const event = transcript[i]
    if (event?.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.search") return i
    }
  }
  return undefined
}

function findHoldTurnIndex(
  transcript: TranscriptEvent[],
): number | undefined {
  for (let i = 0; i < transcript.length; i += 1) {
    const event = transcript[i]
    if (event?.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.holdReservation") return i
    }
  }
  return undefined
}

function findFinalAssistantTurnIndex(
  transcript: TranscriptEvent[],
): number | undefined {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    if (transcript[i]?.type === "assistant") return i
  }
  return undefined
}

function findFirstUserTurnMatching(
  transcript: TranscriptEvent[],
  pattern: RegExp,
): number | undefined {
  for (let i = 0; i < transcript.length; i += 1) {
    const event = transcript[i]
    if (event?.type !== "user") continue
    if (pattern.test(event.message)) return i
  }
  return undefined
}

function getFinalAssistantMessage(transcript: TranscriptEvent[]): string {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = transcript[index]
    if (event?.type === "assistant") {
      return event.message
    }
  }
  return ""
}

export function getHeldReservation(
  transcript: TranscriptEvent[],
): HoldReservationArgs | undefined {
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.holdReservation") {
        return call.args
      }
    }
  }
  return undefined
}

function getSuccessfulHoldReservation(
  transcript: TranscriptEvent[],
): HoldReservationArgs | undefined {
  for (const event of transcript) {
    if (event.type !== "tool_result") continue
    if (event.result.tool !== "restaurants.holdReservation") continue
    if (event.result.result.success) {
      return event.result.args
    }
  }
  return undefined
}

export function getSelectedRestaurantId(
  transcript: TranscriptEvent[],
): string | undefined {
  return getHeldReservation(transcript)?.restaurantId
}

function hasTradeoffExplanation(message: string): boolean {
  return /tradeoff|north beach|farther/i.test(message)
}

function scoreTaskSuccess(
  transcript: TranscriptEvent[],
  finalAssistantMessage: string,
): number {
  const successfulHold = getSuccessfulHoldReservation(transcript)
  if (
    successfulHold?.restaurantId === "rest_002" &&
    (successfulHold.time === "19:30" || successfulHold.time === "20:00")
  ) {
    return 30
  }
  if (
    successfulHold?.restaurantId === "rest_004" &&
    hasTradeoffExplanation(finalAssistantMessage)
  ) {
    return 22
  }
  if (successfulHold) {
    return 12
  }
  return 0
}

function scoreIntentFidelityWithDiagnosis(
  transcript: TranscriptEvent[],
  finalAssistantMessage: string,
): { score: number; dimensions: IntentDimensionResult[] } {
  const holdTurn = findHoldTurnIndex(transcript)
  const searchTurn = findFirstSearchTurnIndex(transcript)
  // Failure-or-honor turn for held-reservation dimensions: the hold turn if
  // it exists, else the final assistant turn (so an agent that never held
  // anything still has something to point at).
  const holdOrFinalTurn =
    holdTurn ?? findFinalAssistantTurnIndex(transcript)
  const cuisineOrigin = findFirstUserTurnMatching(
    transcript,
    /italian over sushi|chose italian/i,
  )
  const timeOrigin = findFirstUserTurnMatching(
    transcript,
    /not to start before 7pm|after 7pm/i,
  )
  const budgetOrigin = findFirstUserTurnMatching(
    transcript,
    /\$80\/person|80\/person|80 per person/i,
  )
  const locationOrigin = findFirstUserTurnMatching(
    transcript,
    /union square/i,
  )
  const dietaryOrigin = findFirstUserTurnMatching(
    transcript,
    /priya.*vegetarian|vegetarian/i,
  )

  // CRITICAL: fidelity is awarded for SUCCESSFUL holds only. An agent that calls
  // holdReservation with an unavailable time gets a failed hold — they did not
  // actually faithfully execute the intent. Earlier this used getHeldReservation
  // (the requested hold), which is gameable: hold rest_002 at 21:00 (unavailable),
  // pocket all the intent-fidelity points, lose only task success.
  const heldReservation = getSuccessfulHoldReservation(transcript)
  const selectedRestaurantId = heldReservation?.restaurantId
  const selectedRestaurant = RESTAURANTS.find(
    (restaurant) => restaurant.id === selectedRestaurantId,
  )
  const mentionsItalian = /italian/i.test(finalAssistantMessage)
  const mentionsTradeoff = /tradeoff/i.test(finalAssistantMessage)
  const mentionsLocationTradeoff = /tradeoff|north beach|farther/i.test(
    finalAssistantMessage,
  )

  const dimensions: IntentDimensionResult[] = []

  // Cuisine: Italian over sushi
  const italianHonored =
    selectedRestaurantId === "rest_002" ||
    selectedRestaurantId === "rest_004" ||
    mentionsItalian
  dimensions.push({
    id: "cuisine_italian",
    description: "Honors team's Italian-over-sushi decision",
    honored: italianHonored,
    weight: 7,
    evidence: italianHonored
      ? `selected ${selectedRestaurantId ?? "(none)"}; mentions Italian: ${mentionsItalian}`
      : "no Italian selection or mention",
    originTurnIndex: cuisineOrigin,
    failureTurnIndex: holdOrFinalTurn,
  })

  // Time: after 7pm
  const timeHonored = !!heldReservation && heldReservation.time >= "19:00"
  dimensions.push({
    id: "time_after_7pm",
    description: "Honors after-7pm preference",
    honored: timeHonored,
    weight: 7,
    evidence: heldReservation
      ? `held time ${heldReservation.time}`
      : "no reservation held",
    originTurnIndex: timeOrigin,
    failureTurnIndex: holdOrFinalTurn,
  })

  // Budget: <= $80/person
  let budgetScore = 0
  let budgetEvidence = "no restaurant selected"
  let budgetHonored = false
  if (selectedRestaurant) {
    if (selectedRestaurant.priceEstimatePerPerson <= 80) {
      budgetScore = 7
      budgetHonored = true
      budgetEvidence = `selected $${selectedRestaurant.priceEstimatePerPerson}/person`
    } else if (
      selectedRestaurant.priceEstimatePerPerson <= 90 &&
      mentionsTradeoff
    ) {
      budgetScore = 4
      budgetHonored = true
      budgetEvidence = `selected $${selectedRestaurant.priceEstimatePerPerson}/person, explained tradeoff`
    } else {
      budgetEvidence = `selected $${selectedRestaurant.priceEstimatePerPerson}/person — over budget, no tradeoff`
    }
  }
  dimensions.push({
    id: "budget_80",
    description: "Honors ~$80/person budget",
    honored: budgetHonored,
    weight: 7,
    evidence: budgetEvidence,
    originTurnIndex: budgetOrigin,
    failureTurnIndex: holdOrFinalTurn,
  })

  // Location: Union Square
  let locationScore = 0
  let locationHonored = false
  let locationEvidence = "no selection"
  if (selectedRestaurantId === "rest_002") {
    locationScore = 7
    locationHonored = true
    locationEvidence = "Union Square"
  } else if (
    selectedRestaurantId === "rest_004" &&
    mentionsLocationTradeoff
  ) {
    locationScore = 5
    locationHonored = true
    locationEvidence = "North Beach with tradeoff explanation"
  } else if (selectedRestaurantId) {
    locationEvidence = `selected ${selectedRestaurantId} — wrong neighborhood, no tradeoff explanation`
  }
  dimensions.push({
    id: "location_union_square",
    description: "Honors Union Square location",
    honored: locationHonored,
    weight: 7,
    evidence: locationEvidence,
    originTurnIndex: locationOrigin,
    failureTurnIndex: holdOrFinalTurn,
  })

  // Dietary: vegetarian + no shellfish-heavy
  const dietaryHonored =
    selectedRestaurantId === "rest_002" || selectedRestaurantId === "rest_004"
  dimensions.push({
    id: "dietary_safe",
    description: "Honors Priya vegetarian + Miguel no-shellfish",
    honored: dietaryHonored,
    weight: 7,
    evidence: dietaryHonored
      ? `selected ${selectedRestaurantId} (vegetarian-friendly, not seafood-heavy)`
      : `selected ${selectedRestaurantId ?? "none"} — fails dietary constraints`,
    originTurnIndex: dietaryOrigin,
    failureTurnIndex: holdOrFinalTurn,
  })

  // v0.6: Query fidelity — did the agent translate memory into the search args?
  // 2 points per relevant arg, max 10. Reveals agents that "know the answer" but
  // can't operationalize it through the tool interface.
  const searchArgs = getFirstSearchArgs(transcript)
  let queryScore = 0
  const queryParts: string[] = []
  if (searchArgs) {
    if (searchArgs.location?.toLowerCase().includes("union square")) {
      queryScore += 2
      queryParts.push("location=Union Square ✓")
    } else queryParts.push(`location=${searchArgs.location ?? "(unset)"} ✗`)
    if (searchArgs.cuisine?.toLowerCase() === "italian") {
      queryScore += 2
      queryParts.push("cuisine=Italian ✓")
    } else queryParts.push(`cuisine=${searchArgs.cuisine ?? "(unset)"} ✗`)
    if (
      searchArgs.maxPricePerPerson !== undefined &&
      searchArgs.maxPricePerPerson <= 90 &&
      searchArgs.maxPricePerPerson >= 60
    ) {
      queryScore += 2
      queryParts.push(`maxPrice=${searchArgs.maxPricePerPerson} ✓`)
    } else queryParts.push(`maxPrice=${searchArgs.maxPricePerPerson ?? "(unset)"} ✗`)
    if (searchArgs.requiresVegetarian === true) {
      queryScore += 2
      queryParts.push("requiresVegetarian=true ✓")
    } else queryParts.push("requiresVegetarian=(unset) ✗")
    if (searchArgs.avoidShellfish === true) {
      queryScore += 2
      queryParts.push("avoidShellfish=true ✓")
    } else queryParts.push("avoidShellfish=(unset) ✗")
  } else {
    queryParts.push("no restaurants.search call")
  }
  dimensions.push({
    id: "query_fidelity",
    description: "Translates memory into restaurants.search args",
    honored: queryScore >= 8,
    weight: 10,
    evidence: queryParts.join(", "),
    failureTurnIndex: searchTurn ?? holdOrFinalTurn,
  })

  // Total
  const score =
    (italianHonored ? 7 : 0) +
    (timeHonored ? 7 : 0) +
    budgetScore +
    locationScore +
    (dietaryHonored ? 7 : 0) +
    queryScore

  return { score, dimensions }
}

function scoreRecallBurden(recallBurdenEvents: RecallBurdenEvent[]): number {
  const uniqueRecallCategories = new Set(
    recallBurdenEvents.map((event) => event.category),
  )
  return Math.max(0, 20 - uniqueRecallCategories.size * 5)
}

function scoreClarificationQuality(args: {
  askedPartySize: boolean
  recallBurdenCategoryCount: number
  heldReservation?: HoldReservationArgs
}): number {
  if (args.askedPartySize && args.recallBurdenCategoryCount === 0) return 10
  if (args.askedPartySize && args.recallBurdenCategoryCount === 1) return 6
  if (args.askedPartySize && args.recallBurdenCategoryCount > 1) return 3
  if (!args.askedPartySize && args.heldReservation) return 4
  return 0
}

function scoreToolUseEfficiency(transcript: TranscriptEvent[]): number {
  let searched = false
  let held = false

  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.search") searched = true
      if (call.tool === "restaurants.holdReservation") held = true
    }
  }

  if (searched && held) return 5
  if (searched) return 3
  return 0
}

export function dinnerJudge(input: ScenarioJudgeInput): EvaluationResult {
  const heldReservation = getHeldReservation(input.transcript)
  const selectedRestaurantId = getSelectedRestaurantId(input.transcript)
  const finalAssistantMessage = getFinalAssistantMessage(input.transcript)
  const uniqueRecallCategories = new Set(
    input.recallBurdenEvents.map((event) => event.category),
  )

  const taskSuccess = scoreTaskSuccess(input.transcript, finalAssistantMessage)
  const fidelity = scoreIntentFidelityWithDiagnosis(
    input.transcript,
    finalAssistantMessage,
  )
  const recallBurden = scoreRecallBurden(input.recallBurdenEvents)
  const clarificationQuality = scoreClarificationQuality({
    askedPartySize: input.askedRequiredFields.has("partySize"),
    recallBurdenCategoryCount: uniqueRecallCategories.size,
    heldReservation,
  })
  const toolUseEfficiency = scoreToolUseEfficiency(input.transcript)
  const totalScore =
    taskSuccess +
    fidelity.score +
    recallBurden +
    clarificationQuality +
    toolUseEfficiency

  return {
    agentName: input.agentName,
    scenarioId: input.scenarioId,
    totalScore,
    taskSuccess,
    intentFidelity: fidelity.score,
    recallBurden,
    clarificationQuality,
    toolUseEfficiency,
    recallBurdenEvents: input.recallBurdenEvents,
    selectedRestaurantId,
    heldReservation,
    transcript: input.transcript,
    intentDimensionResults: fidelity.dimensions,
  }
}
