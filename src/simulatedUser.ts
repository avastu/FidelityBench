import type {
  RecallBurdenCategory,
  RecallBurdenEvent,
  SimulatedUserResultV2,
} from "./types.js"

const PATTERNS: Record<RecallBurdenCategory, RegExp[]> = {
  cuisine: [
    /what (cuisine|kind of food|type of food)/i,
    /any preference.*(cuisine|food)/i,
    /what.*restaurant.*type/i,
    /what.*food.*want/i,
  ],
  budget: [
    /what.*budget/i,
    /price range/i,
    /how much.*spend/i,
    /cost.*limit/i,
    /budget.*for/i,
  ],
  dietary: [
    /(any|what|other).*dietary/i,
    /(any|what).*allerg/i,
    /(any|other|what).*(vegetarian|vegan)/i,
    /food restrictions/i,
    /(any|what).*restrictions/i,
  ],
  location: [
    /where.*(look|search|book|reserve)/i,
    /what.*neighborhood/i,
    /which area/i,
    /what.*location/i,
    /near where/i,
  ],
  time: [
    /what time/i,
    /when.*dinner/i,
    /preferred time/i,
    /what.*start/i,
    /what time.*book/i,
  ],
}

const PARTY_SIZE_PATTERNS = [
  /party size/i,
  /how many people/i,
  /how many.*attending/i,
  /number of people/i,
  /for how many/i,
  /how many guests/i,
]

function matchAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message))
}

// Limits regex matching to interrogative clauses so declarative success messages
// like "...with real vegetarian options..." don't trigger false recall-burden hits.
function questionPortion(message: string): string {
  const sentences = message.split(/(?<=[.!?])\s+/)
  const questions = sentences.filter((s) => s.trim().endsWith("?"))
  return questions.join(" ")
}

export const dinnerSimulatedUser = (
  assistantMessage: string,
): SimulatedUserResultV2 => {
  const recallBurdenEvents: RecallBurdenEvent[] = []
  const questionText = questionPortion(assistantMessage)
  const categories = Object.keys(PATTERNS) as RecallBurdenCategory[]
  for (const category of categories) {
    const patterns = PATTERNS[category]
    if (questionText && matchAny(questionText, patterns)) {
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
      response: "8 people.",
      recallBurdenEvents,
      askedRequiredFields,
    }
  }

  if (recallBurdenEvents.length > 0) {
    const responses: string[] = []
    for (const event of recallBurdenEvents) {
      if (event.category === "cuisine") {
        responses.push("We decided Italian over sushi last week.")
      }
      if (event.category === "budget") {
        responses.push("Around $80/person.")
      }
      if (event.category === "dietary") {
        responses.push("Priya is vegetarian, and Miguel avoids shellfish.")
      }
      if (event.category === "location") {
        responses.push("We're staying near Union Square.")
      }
      if (event.category === "time") {
        responses.push("After 7pm — I feel rushed before then.")
      }
    }
    return {
      shouldRespond: true,
      response: responses.join(" "),
      recallBurdenEvents,
      askedRequiredFields,
    }
  }

  return {
    shouldRespond: false,
    recallBurdenEvents,
    askedRequiredFields,
  }
}
