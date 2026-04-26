import type { Agent } from "./Agent.js"
import type {
  AgentInput,
  AgentOutput,
  Restaurant,
  ToolCall,
  ToolResult,
} from "../types.js"

type MemoryState = {
  preferredDinnerStartTime?: string
  dietaryNotes: string[]
  cuisineDecision?: string
  budgetPerPerson?: number
  location?: string
  partySize?: number
  finalTaskActive?: boolean
  searched?: boolean
}

export class RuleMemoryAgent implements Agent {
  name = "RuleMemoryAgent"
  private memory: MemoryState = { dietaryNotes: [] }

  reset() {
    this.memory = { dietaryNotes: [] }
  }

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (input.inputType === "tool_result") {
      return this.handleToolResult(input.message)
    }

    this.ingestUserMessage(input.message)

    if (/plan.*offsite dinner|team offsite dinner/i.test(input.message)) {
      this.memory.finalTaskActive = true
      if (!this.memory.partySize) {
        return {
          message:
            "I'll look for Italian options near Union Square after 7pm, around $80/person, with real vegetarian options and not seafood-heavy. What party size should I use?",
        }
      }
      return this.searchRestaurants()
    }

    if (this.memory.finalTaskActive && /8 people/i.test(input.message)) {
      this.memory.partySize = 8
      return this.searchRestaurants()
    }

    return { message: "Got it." }
  }

  private ingestUserMessage(message: string) {
    if (/not to start before 7pm|after 7pm/i.test(message)) {
      this.memory.preferredDinnerStartTime = "19:00"
    }
    if (/Priya.*vegetarian/i.test(message)) {
      this.memory.dietaryNotes.push(
        "Priya is vegetarian and needs real vegetarian options.",
      )
    }
    if (/Miguel.*shellfish|seafood-heavy/i.test(message)) {
      this.memory.dietaryNotes.push(
        "Miguel avoids shellfish; avoid seafood-heavy restaurants.",
      )
    }
    if (/Italian over sushi|chose Italian/i.test(message)) {
      this.memory.cuisineDecision = "Italian"
    }
    if (/\$80\/person|80\/person|80 per person/i.test(message)) {
      this.memory.budgetPerPerson = 80
    }
    if (/Union Square/i.test(message)) {
      this.memory.location = "Union Square"
    }
    if (/8 people/i.test(message)) {
      this.memory.partySize = 8
    }
  }

  private searchRestaurants(): AgentOutput {
    const toolCalls: ToolCall[] = [
      {
        tool: "restaurants.search",
        args: {
          location: this.memory.location,
          date: "2026-05-20",
          time: "19:30",
          partySize: this.memory.partySize,
        },
      },
    ]
    return {
      message: "I'll search dinner options now.",
      toolCalls,
    }
  }

  private handleToolResult(toolResultMessage: string): AgentOutput {
    let restaurants: Restaurant[] = []
    try {
      const parsed = JSON.parse(toolResultMessage) as ToolResult
      if (parsed.tool === "restaurants.search") {
        restaurants = parsed.result
      } else {
        // holdReservation result — nothing more to do
        return {
          message: "Reservation confirmed.",
        }
      }
    } catch {
      return { message: "I had trouble reading the restaurant results." }
    }

    const bella = restaurants.find((r) => r.id === "rest_002")
    if (!bella || !this.memory.partySize) {
      return { message: "I could not find a suitable reservation to hold." }
    }

    return {
      message:
        "Bella Tavola looks like the best fit: it's Italian, near Union Square, around $72/person, has several vegetarian mains, and is not seafood-focused. I'll place a hold for 8 people at 7:30pm.",
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
