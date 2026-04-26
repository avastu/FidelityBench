import type { AgentInput, AgentOutput } from "../types.js"

export interface Agent {
  name: string
  handleMessage(input: AgentInput): Promise<AgentOutput>
  reset?(): Promise<void> | void
}
