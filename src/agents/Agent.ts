import type { AgentInput, AgentOutput } from "../types.js"

export interface Agent {
  name: string
  handleMessage(input: AgentInput): Promise<AgentOutput>
  reset?(): Promise<void> | void
  // True for agents whose behavior depends on a stochastic LLM (or any other
  // non-deterministic source). The runner uses this to decide whether to run
  // multiple trials when --trials N is set; deterministic agents always run
  // once because additional trials would produce identical scores.
  nondeterministic?: boolean
}
