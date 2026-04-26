import type { Agent } from "./Agent.js"
import type { AgentInput, AgentOutput } from "../types.js"

export class StatelessAgent implements Agent {
  name = "StatelessAgent"

  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (/plan.*dinner|offsite dinner/i.test(input.message)) {
      return {
        message:
          "Sure — what cuisine, budget, location, time, dietary restrictions, and party size should I keep in mind?",
      }
    }
    if (/8 people/i.test(input.message)) {
      return {
        message:
          "Thanks. I can look for dinner options once I know cuisine, budget, location, and dietary restrictions.",
      }
    }
    return { message: "Got it." }
  }
}
