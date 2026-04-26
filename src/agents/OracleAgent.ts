// OracleAgent: a hand-built "perfect" agent that handles all v0.5 scenarios.
// It exists to validate that each scenario's rubric is actually achievable
// (i.e., the bench can distinguish 100/100 fidelity from 0/100).
//
// IMPORTANT: it does NOT use input.scenarioId. Real agents do not get scenario
// hints, and earlier versions of this file routed on scenarioId — making the
// Oracle a cheat sheet rather than a validation. It now pattern-matches the
// CONTENT of each timeline message (same surface a real agent would see) and
// builds its own memory of what it's heard.

import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  Restaurant,
  ToolResult,
} from "../types.js"

type Mode = "dinner" | "lunch" | "board" | "unknown"

type OracleMemory = {
  // mode is detected from message content, not scenarioId
  mode: Mode
  // logistical
  partySize?: number
  cuisinePreference?: string
  budgetCeiling?: number
  location?: string
  preferredStartTime?: string
  vegetarianRequired?: boolean
  avoidShellfish?: boolean
  // temporal supersession tracking
  cuisineHistory: string[]
  // board update
  boardUpdateRequested?: boolean
  boardFrameNotes: string[]
  staffingBoundaryAcknowledged?: boolean
  // dispatch
  finalTaskActive?: boolean
}

const BOARD_DRAFT = `Subject: Q-update — pilots & risk mitigation

We have three customer pilots in flight: two are on schedule and one is on a slightly extended ramp as we tune the integration surface. Across all three the early signal is strong: the pilots are completing primary workflows and the design partners are engaging weekly with the product team. We are converting that engagement directly into the next iteration.

On execution risk, the largest exposure is integration depth at the second pilot. We have already split the workstream and assigned a clear single-threaded owner; the mitigation plan is in place and tracking. We will share the next checkpoint at the regular cadence.

Net: pilots are on a path to convert, and the risk we are most focused on has a named owner and an explicit mitigation. No asks for the board this update.`

export class OracleAgent implements Agent {
  name = "OracleAgent"
  private memory: OracleMemory = {
    mode: "unknown",
    cuisineHistory: [],
    boardFrameNotes: [],
  }

  reset() {
    this.memory = {
      mode: "unknown",
      cuisineHistory: [],
      boardFrameNotes: [],
    }
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (input.inputType === "tool_result") {
      return this.handleSearchResult(input.message)
    }
    this.ingest(input.message)
    return this.maybeAct(input.message)
  }

  // Read each user message and update memory + mode hint.
  private ingest(message: string) {
    // Mode hints — detect by content, not scenarioId.
    if (/team offsite dinner|offsite dinner/i.test(message)) {
      this.memory.mode = "dinner"
      this.memory.finalTaskActive = true
    }
    if (/team lunch|book.*lunch.*for/i.test(message) && /\bmonday\b/i.test(message)) {
      this.memory.mode = "lunch"
      this.memory.finalTaskActive = true
    }
    if (/draft the board update/i.test(message)) {
      this.memory.mode = "board"
      this.memory.boardUpdateRequested = true
    }

    // Logistical extractions
    if (/not to start before 7pm|after 7pm/i.test(message)) {
      this.memory.preferredStartTime = "19:00"
    }
    if (/Priya.*vegetarian/i.test(message)) {
      this.memory.vegetarianRequired = true
    }
    if (/Miguel.*shellfish|seafood-heavy/i.test(message)) {
      this.memory.avoidShellfish = true
    }
    if (/(chose|going with).*\b(italian|sushi|mexican|thai)\b/i.test(message)) {
      const m = /(italian|sushi|mexican|thai)/i.exec(message)
      const cuisine = m?.[1]?.toLowerCase()
      if (cuisine) {
        this.memory.cuisinePreference = cuisine
        this.memory.cuisineHistory.push(cuisine)
      }
    }
    if (/scratch the (italian|sushi|mexican|thai) idea|let's go (?:in that direction|with) (?:in)?stead/i.test(message)) {
      const next = /craving (italian|sushi|mexican|thai)|(italian|sushi|mexican|thai) (?:lately|instead)/i.exec(message)
      if (next) {
        const cuisine = (next[1] ?? next[2] ?? "").toLowerCase()
        if (cuisine) {
          this.memory.cuisinePreference = cuisine
          this.memory.cuisineHistory.push(cuisine)
        }
      }
    }
    if (/Italian sounds good/i.test(message)) {
      this.memory.cuisinePreference = "italian"
      this.memory.cuisineHistory.push("italian")
    }
    if (/craving Mexican|Mexican.*lately|let's go in that direction/i.test(message)) {
      this.memory.cuisinePreference = "mexican"
      this.memory.cuisineHistory.push("mexican")
    }
    const budgetMatch = /\$\s*(\d+)\s*\/\s*person|around\s*\$\s*(\d+)\s*\/\s*person|under\s*\$\s*(\d+)/i.exec(message)
    if (budgetMatch) {
      const v = budgetMatch[1] ?? budgetMatch[2] ?? budgetMatch[3]
      if (v) this.memory.budgetCeiling = parseInt(v, 10)
    }
    if (/Union Square/i.test(message)) this.memory.location = "Union Square"
    if (/Mission/i.test(message)) this.memory.location = "Mission"

    // Board content
    if (/board updates? should be concise/i.test(message)) {
      this.memory.boardFrameNotes.push("concise and confident, not hedgy")
    }
    if (/launch is slipping|team is stretched/i.test(message)) {
      this.memory.boardFrameNotes.push("private worry: do not externalize")
    }
    if (/don'?t mention staffing|that'?s a boundary/i.test(message)) {
      this.memory.staffingBoundaryAcknowledged = true
    }
    if (/customer pilots/i.test(message) && /risk mitigation/i.test(message)) {
      this.memory.boardFrameNotes.push("frame: customer pilots + risk mitigation")
    }

    // Party size from sim user — REQUIRE a person-count noun so "May 20" doesn't trip.
    const sizeMatch = /\b(\d+)\s+(people|of us|guests|attending|persons|in our party)/i.exec(message)
    if (this.memory.finalTaskActive && sizeMatch && !this.memory.partySize) {
      const v = sizeMatch[1]
      if (v) this.memory.partySize = parseInt(v, 10)
    }
  }

  private maybeAct(message: string): AgentOutput {
    if (this.memory.mode === "board" && this.memory.boardUpdateRequested) {
      return { message: BOARD_DRAFT }
    }
    if (this.memory.mode === "dinner" && /plan.*offsite dinner|team offsite dinner/i.test(message)) {
      if (!this.memory.partySize) {
        return {
          message:
            "I'll book Italian near Union Square for after 7pm, around $80/person, with strong vegetarian options and not seafood-heavy. What party size should I use?",
        }
      }
      return this.searchDinner()
    }
    if (this.memory.mode === "dinner" && /\b\d+\b/.test(message) && this.memory.partySize) {
      return this.searchDinner()
    }
    if (this.memory.mode === "lunch" && /book.*team lunch|team lunch.*for/i.test(message)) {
      if (!this.memory.partySize) {
        return {
          message:
            "I'll book Mexican in the Mission for Monday lunch, under $50/person, with strong vegetarian options for Priya. How many people?",
        }
      }
      return this.searchLunch()
    }
    if (this.memory.mode === "lunch" && /\b\d+\b/.test(message) && this.memory.partySize) {
      return this.searchLunch()
    }
    return { message: "Got it." }
  }

  private searchDinner(): AgentOutput {
    return {
      message: "Searching now.",
      toolCalls: [
        {
          tool: "restaurants.search",
          args: {
            location: this.memory.location ?? "Union Square",
            date: "2026-05-20",
            time: "19:30",
            partySize: this.memory.partySize ?? 8,
            cuisine: this.memory.cuisinePreference ?? "Italian",
            maxPricePerPerson: this.memory.budgetCeiling ?? 80,
            requiresVegetarian: this.memory.vegetarianRequired ?? true,
            avoidShellfish: this.memory.avoidShellfish ?? true,
          },
        },
      ],
    }
  }

  private searchLunch(): AgentOutput {
    return {
      message: "Searching now.",
      toolCalls: [
        {
          tool: "restaurants.search",
          args: {
            location: this.memory.location ?? "Mission",
            date: "2026-05-11",
            time: "12:30",
            partySize: this.memory.partySize ?? 6,
            cuisine: this.memory.cuisinePreference ?? "Mexican",
            maxPricePerPerson: this.memory.budgetCeiling ?? 50,
            requiresVegetarian: this.memory.vegetarianRequired ?? true,
          },
        },
      ],
    }
  }

  private handleSearchResult(toolResultMessage: string): AgentOutput {
    const restaurants = parseSearchResult(toolResultMessage)
    if (!restaurants) return { message: "Reservation confirmed." }

    if (this.memory.mode === "lunch") {
      const choice = restaurants.find((r) => r.id === "rest_005")
      if (!choice || !this.memory.partySize) {
        return { message: "I could not find a suitable option to hold." }
      }
      return {
        message: `${choice.name} is the best fit: Mexican, Mission, has tofu burrito options for Priya, ~$${choice.priceEstimatePerPerson}/person — well under our $50 ceiling. Holding for lunch.`,
        toolCalls: [
          {
            tool: "restaurants.holdReservation",
            args: {
              restaurantId: choice.id,
              date: "2026-05-11",
              time: "12:30",
              partySize: this.memory.partySize,
            },
          },
        ],
      }
    }

    // dinner
    const bella = restaurants.find((r) => r.id === "rest_002")
    if (!bella || !this.memory.partySize) {
      return { message: "I could not find a suitable option to hold." }
    }
    return {
      message:
        "Bella Tavola is the best fit: Italian, Union Square, ~$72/person, strong vegetarian options, not seafood-heavy. Holding for 7:30pm.",
      toolCalls: [
        {
          tool: "restaurants.holdReservation",
          args: {
            restaurantId: "rest_002",
            date: "2026-05-20",
            time: "19:30",
            partySize: this.memory.partySize,
          },
        },
      ],
    }
  }

}

function parseSearchResult(toolResultMessage: string): Restaurant[] | null {
  try {
    const parsed = JSON.parse(toolResultMessage) as ToolResult
    if (parsed.tool !== "restaurants.search") return null
    return parsed.result
  } catch {
    return null
  }
}

