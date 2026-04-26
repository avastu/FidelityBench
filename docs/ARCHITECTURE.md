# FidelityBench Architecture

FidelityBench is intentionally small: a local runner, scenario bundles, agents, tools, simulated users, and judges.

The core architectural constraint is the current-message-only protocol. The runner never passes transcript history to an agent. If an agent succeeds over time, it must do so through its own memory or retrieval system.

## Flow

```text
Scenario timeline
      ↓
Runner sends one AgentInput at a time
      ↓
Agent stores/retrieves memory internally
      ↓
Agent returns AgentOutput: message + optional toolCalls
      ↓
Runner executes tools and returns tool_result inputs
      ↓
Scenario simulatedUser responds to clarification questions
      ↓
Scenario judge scores transcript
      ↓
Report + results/latest-run.json
```

## Core protocol

Every agent receives only:

```ts
export type AgentInput = {
  runId: string
  scenarioId: string
  userId: string
  timestamp: string
  inputType: "user" | "tool_result"
  message: string
}
```

Every agent returns:

```ts
export type AgentOutput = {
  message: string
  toolCalls?: ToolCall[]
}
```

This is the benchmark's core design choice. FidelityBench tests whether the agent can carry context, not whether the runner can paste the transcript back in.

## Scenario bundles

Each active scenario is a `ScenarioBundle`:

```ts
export type ScenarioBundle = {
  scenario: Scenario
  simulatedUser: SimulatedUserFn
  judge: ScenarioJudge
  requiredFields: string[]
  family: "action" | "reflection"
  maxScore: number
  maxIntentFidelity?: number
  probes?: string
}
```

That means a scenario owns:

- the user timeline
- the final task
- simulated user behavior
- scoring logic
- metric ceilings
- report description

The runner stays generic.

## Agents

Built-in agents implement:

```ts
interface Agent {
  name: string
  handleMessage(input: AgentInput): Promise<AgentOutput>
  reset?(): Promise<void> | void
  nondeterministic?: boolean
}
```

Current agent families:

- deterministic local baselines: `StatelessAgent`, `RuleMemoryAgent`
- optional rubric sanity check: `OracleAgent`
- optional LLM baselines: stateless, file memory, transcript, windowed transcript, block memory
- external/product agents through stdio: `StdioAgent`

## Tools

The current MVP includes deterministic restaurant tools:

- `restaurants.search`
- `restaurants.holdReservation`

Tool records expose realistic world state, not evaluator labels. The agent must infer whether a restaurant matches user intent.

## Simulated users

Scenario simulated users exist to measure recall burden.

They can:

- answer genuinely missing questions
- repeat known context when the assistant asks for it
- log recall-burden events

The judge can then penalize agents that make the user carry memory.

## Judges

Judges score the full transcript after a run.

Common metrics:

- task success
- intention fidelity
- recall burden
- clarification quality
- tool use efficiency

Many scenarios also emit per-dimension diagnostics so the score is auditable.

## External agent integration

External agents do not need to be written in TypeScript. FidelityBench can spawn any process that speaks the stdio JSON protocol.

See `docs/EXTERNAL_AGENTS.md` for the protocol and adapter pattern.

## Extension points

To add a new scenario:

1. Create `scenarios/<id>.ts`.
2. Export a `ScenarioBundle`.
3. Add it to optional scenario loading in `src/index.ts`.

To add a new built-in agent:

1. Implement `Agent`.
2. Add an alias in `src/index.ts`.
3. Gate LLM agents behind provider detection if needed.

To evaluate a product agent:

1. Write a small stdio adapter.
2. Set `FIDELITYBENCH_EXTERNAL_AGENT`.
3. Run the benchmark.

## Design principle

Keep the benchmark behaviorally honest.

Do not make agents look better by passing hidden transcript state, adding evaluator labels to tools, or giving full credit after the simulated user launders known context back into the run.
