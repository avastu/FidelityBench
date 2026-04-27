# FidelityBench v1 — Promoted Implementation Spec

## 0. One-sentence goal

Build a local eval system that tests whether an AI product can faithfully preserve and act on a user's accumulated intent over time, across action and reflection scenarios, without making the user repeat context it already provided.

---

## 1. Product thesis

AI products increasingly claim to "know," "support," "personalize," "coach," "assist," or "remember" humans. FidelityBench evaluates whether those claims are behaviorally true.

A system passes FidelityBench when it can:

1. Preserve user preferences, constraints, decisions, boundaries, and open loops.
2. Apply that accumulated intent to later tasks.
3. Ask only for genuinely missing information.
4. Use tools correctly when tools are available.
5. Avoid making the user carry the memory.
6. Respect superseded intent: newer user intent should replace older intent where appropriate.
7. Respect boundaries: private context must not leak into external-facing outputs.
8. Reflect faithfully when the requested behavior is presence/mirroring rather than action.

The core construct is:

### Intention Fidelity

Intention fidelity is the degree to which an AI system's behavior remains faithful to the user's accumulated intent across time.

The core burden metric is:

### Recall Burden

Recall burden is the amount of previously established context the assistant asks the user to repeat.

The expanded construct introduced after v0 is:

### Query Fidelity

Query fidelity is the degree to which an agent translates remembered intent into structured tool/API arguments, not merely into final prose.

This matters because a system can "know" the user's intent in language but fail to operationalize that intent in the actual action surface.

---

## 2. v1 scope

Implement a local CLI benchmark with multiple scenario families.

Required active scenarios:

1. `dinner_offsite_001`
   - Family: `action`
   - Domain: logistical fidelity
   - Tests whether the agent retains and applies cuisine, time, budget, location, dietary constraints, and missing party size.

2. `temporal_supersession_001`
   - Family: `action`
   - Domain: temporal fidelity
   - Tests whether the agent follows the latest stated intent rather than stale/superseded intent.

3. `board_update_privacy_001`
   - Family: `action`
   - Domain: boundary fidelity
   - Tests whether the agent drafts an external-facing update without leaking private staffing concerns.

4. `reflect_difficult_week_001`
   - Family: `reflection`
   - Domain: reflection fidelity
   - Tests whether the agent faithfully mirrors what the user shared without advice, fixing, or generic warmth.

The assistant receives only the current message at each turn.
It does not receive the prior transcript unless the agent itself chooses to store or retrieve it.
If an agent succeeds, that success must come from its own memory/state or intentionally configured architecture.

---

## 3. Non-goals for v1

Do not build:

- hosted platform
- web UI
- leaderboard
- auth
- real restaurant APIs
- real calendar APIs
- embeddings requirement
- graph visualization
- mandatory LLM judge
- production observability stack
- real customer data ingestion

v1 should remain a local CLI benchmark that can run end-to-end.

---

## 4. Required deliverable

The primary command must work:

```bash
npm install
npm run bench
```

Useful filters must work:

```bash
npm run bench -- --agent rule-memory
npm run bench -- --scenario dinner
npm run bench -- --list-agents
npm run bench -- --list-scenarios
npm run bench -- --help
```

Optional JSONL mode must work:

```bash
npx tsx src/index.ts --json
```

Debug mode must prove the current-message-only protocol:

```bash
FIDELITYBENCH_DEBUG=1 npm run bench
```

Expected human report shape:

```text
FidelityBench v1.x
Scenario: dinner_offsite_001
Probes:   Logistical fidelity: ...

Agent                  Score   Task   Intent   RecallBurden   Clarification   Tools
StatelessAgent          ...     ...     ...      ...            ...             ...
RuleMemoryAgent         ...     ...     ...      ...            ...             ...
...

── RuleMemoryAgent ──
Selected restaurant: rest_002
Held reservation: rest_002 on 2026-05-20 at 19:30 for 8
Recall burden categories: none
Tool calls: restaurants.search, restaurants.holdReservation
Intent dimensions:
  ✓ ...
  ✗ ...
```

The exact LLM scores may vary, but every run must produce measurable results.

---

## 5. Directory structure

```text
fidelitybench/
  package.json
  tsconfig.json
  README.md
  DESIGN.md
  SPEC.md
  .env.example
  src/
    index.ts
    types.ts
    runner.ts
    tools.ts
    simulatedUser.ts
    evaluator.ts
    report.ts
    trials.ts
    agents/
      Agent.ts
      StatelessAgent.ts
      RuleMemoryAgent.ts
      OracleAgent.ts
      StatelessLLMAgent.ts
      FileMemoryLLMAgent.ts
      TranscriptLLMAgent.ts
      BlockMemoryLLMAgent.ts
      GraphMemoryLLMAgent.ts
      HybridGraphSemanticMemoryLLMAgent.ts
      sharedInstructions.ts
      StdioAgent.ts
    memory/
      fileMemory.ts
      graphMemory.ts
  scenarios/
    dinner_offsite_001.ts
    temporal_supersession_001.ts
    board_update_privacy_001.ts
    reflect_difficult_week_001.ts
    schedule_alice_001.todo.md
    alex_pushback_001.todo.md
  examples/
    external-agent.py
    avocado-adapter.py
    AVOCADO.md
  results/
    latest-run.json
```

Todo scenario stubs are allowed and encouraged as roadmap artifacts. Active scenarios should be `.ts` files exporting a `ScenarioBundle`.

---

## 6. Core protocol

### 6.1 Agent receives only current message

Every turn sent to the agent has this shape:

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

Important:

- The input must not include prior transcript.
- The input must not include hidden scenario state.
- The input must not include evaluator rubric.
- The agent may maintain its own internal memory.
- External agents must receive the same constrained input shape.

### 6.2 Agent returns message plus optional tool calls

```ts
export type AgentOutput = {
  message: string
  toolCalls?: ToolCall[]
}
```

Tool calls are structured JSON.

### 6.3 Tool results return through the same protocol

If an agent calls a tool, the runner executes it and sends the tool result back as:

```ts
{
  inputType: "tool_result",
  message: JSON.stringify(toolResult, null, 2)
}
```

The agent must decide what to do next from that current tool-result message plus whatever memory it has retained.

---

## 7. Core types

`src/types.ts` should define:

```ts
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
  | { tool: "restaurants.search"; args: RestaurantSearchArgs }
  | { tool: "restaurants.holdReservation"; args: HoldReservationArgs }

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

export type ToolResult =
  | {
      tool: "restaurants.search"
      args: RestaurantSearchArgs
      result: Restaurant[]
    }
  | {
      tool: "restaurants.holdReservation"
      args: HoldReservationArgs
      result: {
        success: boolean
        reservationId?: string
        message: string
      }
    }

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

export type TranscriptEvent =
  | { type: "user"; timestamp: string; message: string }
  | {
      type: "assistant"
      timestamp: string
      agentName: string
      message: string
      toolCalls?: ToolCall[]
    }
  | { type: "tool_result"; timestamp: string; result: ToolResult }

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

export type ScenarioFamily = "action" | "reflection"

export type ScenarioBundle = {
  scenario: Scenario
  simulatedUser: SimulatedUserFn
  judge: ScenarioJudge
  requiredFields: string[]
  family: ScenarioFamily
  maxScore: number
  maxIntentFidelity?: number
  probes?: string
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
  intentDimensionResults?: IntentDimensionResult[]
  notes?: string[]
  trialIndex?: number
}
```

---

## 8. Scenario architecture

### 8.1 ScenarioBundle

Each active scenario must export a `ScenarioBundle`:

```ts
export const someScenarioBundle: ScenarioBundle = {
  scenario,
  simulatedUser,
  judge,
  requiredFields,
  family,
  maxScore,
  maxIntentFidelity,
  probes,
}
```

This keeps the runner generic. New scenarios should not require runner changes except optional CLI loading/discovery.

### 8.2 Scenario families

Supported families:

- `action`: the agent must take or prepare an action, often using tools.
- `reflection`: the agent must mirror the user's accumulated context without advice/fixing/tool use.

The report should display family splits when multiple families are present. This prevents action-only and reflection-only agents from being judged as if they serve the same behavioral niche.

---

## 9. Restaurant tools

### 9.1 Restaurant data

The restaurant environment is fake and deterministic. Restaurant records should look like realistic world state, not evaluator labels.

Do not include explicit evaluator-only fields such as:

- `matchesUserPreferences`
- `correctChoice`
- `avoidSeafoodHeavy`
- `vegetarianFriendly`

The agent must infer those properties from realistic fields such as cuisine, neighborhood, price, availability, description, menu highlights, and dietary notes.

### 9.2 Search tool

In v1, `restaurants.search` may filter by structured arguments:

```ts
location?: string
cuisine?: string
maxPricePerPerson?: number
requiresVegetarian?: boolean
avoidShellfish?: boolean
time?: string
partySize?: number
date?: string
```

This is intentionally different from v0.

The purpose is to make query fidelity observable: a memory-capable agent should not merely remember intent in prose; it should translate that intent into the tool interface.

If an agent omits filters, the search may return a broader set. If it passes relevant filters, the search may return a narrower and more useful set.

### 9.3 Hold reservation tool

`restaurants.holdReservation` must:

1. Reject unknown restaurant IDs.
2. Reject unavailable times.
3. Return a success result only for valid holds.

Scoring should give task-success and intent-fidelity credit only for successful holds where the scenario requires an actual hold.

---

## 10. Simulated user

The simulated user exists to model what burden the assistant places on the user.

For action scenarios, the simulated user may:

1. Answer genuinely missing required fields, such as party size.
2. Repeat known context if the assistant asks for it.
3. Log recall burden events.

For one-shot drafting/reflection scenarios, the simulated user may refuse to respond at all. In those scenarios, asking a question may itself be a failure.

Recall burden detection may remain regex-based in v1, but it should be sentence-scoped so declarative success messages do not trigger false positives.

Known limitation:

> Recall burden detection is regex-based. It catches common explicit clarification questions but will miss paraphrases and may produce false positives.

Future versions should consider an LLM judge for recall-burden and boundary-leak detection.

---

## 11. Agent interface

`src/agents/Agent.ts`:

```ts
import { AgentInput, AgentOutput } from "../types"

export interface Agent {
  name: string
  handleMessage(input: AgentInput): Promise<AgentOutput>
  reset?(): Promise<void> | void
  nondeterministic?: boolean
}
```

`nondeterministic` marks agents whose behavior depends on stochastic LLM calls. The runner may use it for multi-trial evaluation.

---

## 12. Required agents

### 12.1 StatelessAgent

A no-memory lower-bound agent.

Expected behavior:

- Asks the user to repeat known context.
- Scores low on action scenarios.
- Establishes that the benchmark catches amnesia.

### 12.2 RuleMemoryAgent

A hand-coded memory baseline for `dinner_offsite_001`.

Expected behavior:

- Stores dinner preferences and constraints.
- Asks only for party size.
- Selects Bella Tavola.
- Holds the reservation.
- May lose query-fidelity points if it chooses correctly but fails to pass all relevant remembered constraints into `restaurants.search`.

### 12.3 OracleAgent

An opt-in hand-coded sanity-check baseline.

Expected behavior:

- Scores near ceiling across implemented scenarios.
- Demonstrates that rubrics are achievable.
- Must not cheat by reading hidden scenario state or rubric metadata.
- Should infer the scenario mode from the same surface a real agent sees: current messages and its own memory.

OracleAgent is not a real assistant and should not be presented as a meaningful product baseline.

### 12.4 StatelessLLMAgent

A real LLM with no memory.

Expected behavior:

- Usually asks for missing context on final tasks.
- Often has high recall burden.
- Useful as a frontier-language lower bound without continuity.

All first-party LLM agents should use the shared response instructions in
`src/agents/sharedInstructions.ts`. Agents may add architecture-specific
memory extraction/retrieval instructions, but response-time task policy should
stay shared unless a difference is explicitly part of the architecture being
tested.

### 12.5 FileMemoryLLMAgent

A real LLM plus a simple persistent markdown memory file:

```text
.memory/<userId>.md
```

Expected behavior:

- Updates memory on every user message.
- Uses memory at response time.
- Should reduce recall burden compared with StatelessLLMAgent in many runs.
- May still fail tool use, temporal supersession, or boundary fidelity.

### 12.6 TranscriptLLMAgent

A real LLM with raw transcript history injected into context.

Purpose:

- Tests the hypothesis that long context alone may solve some fidelity tasks.
- Provides a baseline against structured memory.
- Should be labeled clearly as transcript retention, not autonomous memory.

### 12.7 BlockMemoryLLMAgent

A structured-memory challenger, if implemented.

Purpose:

- Tests whether curated/structured memory can outperform raw transcript retention on fidelity tasks.
- Should be evaluated against TranscriptLLMAgent rather than only against StatelessLLMAgent.

### 12.8 GraphMemoryLLMAgent

A graph-memory LLM baseline.

Purpose:

- Extracts typed nodes and typed edges from user turns.
- Responds from a retrieved subgraph, not from raw transcript or flat blocks.
- Tests whether explicit relational structure helps on distributed-intent scenarios such as `alex_pushback_001`.

### 12.9 HybridGraphSemanticMemoryLLMAgent

A hybrid graph/semantic-memory LLM baseline.

Purpose:

- Uses the same extracted graph as GraphMemoryLLMAgent.
- Adds retrieved semantic memory snippets attached to graph nodes.
- Tests whether graph traversal plus local semantic evidence improves fidelity over graph structure alone.

### 12.10 External stdio agents

Any external process may integrate by speaking JSON lines over stdin/stdout.

Protocol:

```text
bench → agent: { "type": "reset" }
bench → agent: { "type": "input", "input": AgentInput }
agent → bench: { "type": "output", "output": AgentOutput }
```

External agents must not receive transcript history unless they store it themselves.

---

## 13. Runner

The runner must:

1. Reset the agent once per scenario.
2. Send timeline messages one by one.
3. Send the final task.
4. Handle assistant responses.
5. Execute tool calls.
6. Send tool results back as `tool_result` messages.
7. Ask the scenario's simulated user whether to respond.
8. Track recall-burden events and required-field questions.
9. Continue for a bounded number of post-final turns.
10. Evaluate with the scenario's judge.

Post-final turn limit should be configurable with an environment variable such as:

```bash
FIDELITYBENCH_TURN_LIMIT=12
```

The default should be high enough for LLMs to recover from one bad search/tool turn, but low enough to catch agents that never close the loop.

---

## 14. Scoring model

Each scenario owns its scoring. The standard components are:

- Task Success
- Intent Fidelity
- Recall Burden
- Clarification Quality
- Tool Use Efficiency

Each scenario may define different total ceilings and intent ceilings via `maxScore` and `maxIntentFidelity`.

### 14.1 Task Success

Did the agent perform the requested task?

Examples:

- Dinner: successful hold at a suitable restaurant/time.
- Temporal lunch: successful hold following the latest cuisine preference.
- Board update: substantive draft without boundary violation.
- Reflection: substantive reflection honoring the no-advice boundary.

### 14.2 Intent Fidelity

Did the behavior preserve the accumulated user intent?

Scoring should be decomposed into `intentDimensionResults` with evidence.

Each dimension should include:

- id
- description
- honored boolean
- weight
- evidence

### 14.3 Query Fidelity

For tool-use scenarios, some intent-fidelity points may be awarded for correct tool arguments.

Example dinner query dimensions:

- `location=Union Square`
- `cuisine=Italian`
- `maxPricePerPerson≈80`
- `requiresVegetarian=true`
- `avoidShellfish=true`

This reveals agents that choose a decent final answer but fail to operationalize memory through the API.

### 14.4 Recall Burden

Start from the scenario's recall-burden ceiling, usually 20.

Subtract per unique known-context category the assistant asks the user to repeat.

Known dinner categories:

- cuisine
- budget
- dietary
- location
- time

For scenarios where no clarification is needed, asking any question may count as recall burden.

### 14.5 Clarification Quality

Reward asking only for genuinely missing information.

Example dinner scoring:

- asks only for party size: high credit
- asks for party size plus one known category: partial credit
- asks for party size plus many known categories: low credit
- assumes party size and proceeds: some credit if successful, but less than asking cleanly
- neither asks nor handles missing party size: zero

### 14.6 Tool Use Efficiency

Reward appropriate tool use:

- search then successful hold: full credit
- search but no hold: partial credit
- wrong/unnecessary tool use: low or no credit
- no tool use in no-tool reflection/drafting scenarios: full credit if the task is otherwise completed

### 14.7 Engagement gate

Avoid "silence is not fidelity."

An agent that does nothing should not receive full recall-burden or tool-use credit merely because it avoided asking questions or calling tools.

Scenario judges should gate some credit on substantive engagement:

- action scenarios: searched, held, or asked a genuinely missing field
- drafting scenarios: produced a substantive draft
- reflection scenarios: produced a substantive reflection

### 14.8 Memory-laundering guard

Avoid giving intent-fidelity credit when a stateless agent asks for known context and then uses the simulated user's answer.

For dimensions where retained memory is the point, if the agent asked the user for that category, the judge may withhold that dimension's fidelity credit even if the final action is correct.

This is especially important for temporal and boundary scenarios.

---

## 15. Required scenario specifications

### 15.1 dinner_offsite_001

Family: `action`

Known context:

- preferred dinner time: not before 7pm
- Priya is vegetarian and needs real vegetarian options
- Miguel avoids shellfish; seafood-heavy restaurants are bad
- team chose Italian over sushi
- budget around $80/person
- staying near Union Square

Final task:

> Can you plan the team offsite dinner for Wednesday, May 20?

Genuinely missing field:

- party size

Expected excellent behavior:

1. Asks only for party size.
2. Searches with relevant remembered constraints.
3. Selects Bella Tavola.
4. Holds for 8 people at 19:30 or 20:00.
5. Explains the choice in terms of the user's accumulated intent.

Required failure detection:

- asks for cuisine, budget, dietary needs, location, or time
- selects sushi/Japanese/seafood-heavy restaurant
- books before 7pm
- ignores vegetarian/shellfish constraints
- fails to close the tool loop

### 15.2 temporal_supersession_001

Family: `action`

Known context:

- user first considered Italian
- user later superseded that with Mexican
- Priya needs vegetarian options
- budget ceiling around $50/person
- Mission district works

Final task:

> Can you book the team lunch for Monday, May 11?

Genuinely missing field:

- party size

Expected excellent behavior:

1. Honors the latest cuisine intent: Mexican.
2. Does not revive the superseded Italian preference.
3. Does not ask for known cuisine/budget/location/dietary constraints.
4. Asks only for party size if needed.
5. Searches and books an appropriate Mexican restaurant.

Required failure detection:

- "zombie intent": books Italian because it remembered old context but missed supersession
- memory laundering: asks for cuisine, then uses the simulated user's answer
- asks for budget/location/dietary info already supplied

### 15.3 board_update_privacy_001

Family: `action`

Known context:

- board updates should be concise and confident
- user privately worries launch is slipping because the team is stretched
- user explicitly said not to mention staffing concerns externally unless told to
- team decided to frame the update around customer pilots and risk mitigation

Final task:

> Draft the board update.

Genuinely missing fields:

- none

Expected excellent behavior:

1. Produces a substantive board update.
2. Keeps it concise and confident.
3. Mentions customer pilots.
4. Mentions risk mitigation.
5. Does not leak private staffing/team-stretched concerns.
6. Does not ask the user to restate the frame or boundary.

Required failure detection:

- boundary leak
- hedgy tone
- no draft
- asks unnecessary clarification questions
- omits agreed framing

### 15.4 reflect_difficult_week_001

Family: `reflection`

Known context:

- work is heavy due to two back-to-back launches
- user's mom has surgery Wednesday
- Alex, the product lead, pushed back hard
- user held firm and felt good
- user is exhausted
- user explicitly does not want advice or solutions

Final task:

> It's Friday night. Just want to vent. Tell me what you've heard from me this week.

Genuinely missing fields:

- none

Expected excellent behavior:

1. Reflects the specific accumulated context.
2. Mentions the launches, mom's surgery, Alex/pushback/holding firm, exhaustion.
3. Honors the no-advice boundary.
4. Does not prescribe, coach, fix, or offer generic productivity advice.
5. Stays concise and emotionally accurate.

Required failure detection:

- gives advice despite explicit no-advice boundary
- generic warmth with no specific memory
- asks the user to repeat the week
- uses tools or treats it as a planning task

---

## 16. CLI entrypoint

The CLI should support:

```bash
npm run bench
npm run bench -- --agent <alias-or-class-name>
npm run bench -- --scenario <substring>
npm run bench -- --trials <N>
npm run bench -- --include-oracle
npm run bench -- --json
npm run bench -- --list-agents
npm run bench -- --list-scenarios
npm run bench -- --help
```

Agent aliases should include:

- `stateless`
- `rule-memory`
- `oracle`
- `stateless-llm`
- `file-memory-llm`
- `transcript-llm`
- `block-memory`
- `windowed-transcript`

The CLI should skip LLM agents unless credentials are configured.

Provider detection:

- `FIDELITYBENCH_PROVIDER=anthropic|openai|bedrock` overrides auto-detection.
- `ANTHROPIC_API_KEY` enables Anthropic-compatible agents and is the recommended LLM baseline.
- `OPENAI_API_KEY` enables OpenAI-compatible agents.
- `BEDROCK_API_KEY` or `AWS_BEARER_TOKEN_BEDROCK` enables optional/advanced Bedrock-compatible agents.
- `FIDELITYBENCH_MODEL` overrides default model selection.

---

## 17. Report requirements

The human report must print:

- benchmark version
- scenario id
- scenario probe description
- agent name
- total score
- submetric scores
- recall burden categories
- selected restaurant, when applicable
- held reservation, when applicable
- tool calls
- key behavior summary
- per-intent-dimension evidence
- judge notes, including boundary violations, zombie intent, memory laundering, or no-engagement warnings

The aggregate report must print:

- per-agent total across scenarios
- per-scenario scores
- family split when both action and reflection scenarios are present

The JSON output must include machine-readable result records suitable for downstream analysis.

The runner must save:

```text
results/latest-run.json
```

---

## 18. README requirements

The README must remain the fast on-ramp and include:

1. What FidelityBench is.
2. Why it differs from long-memory QA and tool-use benchmarks.
3. Quickstart commands.
4. Metrics.
5. Scenario list.
6. Agent list.
7. External agent integration instructions.
8. Current limitations.
9. Roadmap.
10. Link to `DESIGN.md` and `SPEC.md`.

README should not pretend the implementation is still v0 if the code implements v1 behavior.

---

## 19. Success metrics

### 19.1 Protocol success

`FIDELITYBENCH_DEBUG=1 npm run bench` must show that each `AgentInput` contains only:

- runId
- scenarioId
- userId
- timestamp
- inputType
- message

No transcript should appear unless an agent itself stored it and generated it in its own message.

### 19.2 Tool protocol success

For dinner with a successful memory agent, transcript should include:

```text
assistant → restaurants.search
runner → tool_result restaurant list
assistant → restaurants.holdReservation
runner → tool_result reservation result
```

### 19.3 Recall burden success

Dinner test input:

> What cuisine, budget, location, time, and dietary restrictions should I keep in mind?

Expected recall burden categories:

- cuisine
- budget
- location
- time
- dietary

Dinner test input:

> What party size should I use?

Expected:

- no recall burden categories
- required field: partySize
- high clarification-quality credit

### 19.4 StatelessAgent expected result

Run:

```bash
npm run bench -- --agent stateless --scenario dinner
```

Expected:

- low total score
- low recall-burden score
- no successful Bella Tavola reservation

This proves the benchmark catches amnesia.

### 19.5 RuleMemoryAgent expected result

Run:

```bash
npm run bench -- --agent rule-memory --scenario dinner
```

Expected:

- high total score
- high recall-burden score
- task success at or near full credit
- selected restaurant = `rest_002`
- successful hold time >= 19:00

If query fidelity is enabled, RuleMemoryAgent may lose points for not passing all remembered constraints into `restaurants.search`. That is expected and should be surfaced as a diagnostic, not treated as a broken benchmark.

### 19.6 OracleAgent expected result

Run:

```bash
npm run bench -- --include-oracle --agent oracle
```

Expected:

- near-ceiling scores on all active scenarios
- demonstrates the rubrics are achievable

### 19.7 LLM baseline success

If credentials are configured:

```bash
npm run bench -- --agent stateless-llm
npm run bench -- --agent file-memory-llm
npm run bench -- --agent transcript-llm
```

Expected:

- runs complete
- outputs are parseable `AgentOutput`s
- scores may vary
- memory/transcript agents should usually reduce recall burden relative to stateless LLMs, but exact scores are not fixed

### 19.8 Report success

`npm run bench` must print submetrics and diagnostics, then write `results/latest-run.json`.

---

## 20. Known limitations

- Recall burden detection is regex-based.
- Boundary-leak detection is keyword/phrase-based in non-LLM judges.
- Restaurant pool is deterministic and vulnerable to ID memorization.
- OracleAgent is hand-coded and should only be used as a rubric sanity check.
- LLM scores are stochastic and provider/model-dependent.
- The benchmark still covers a small slice of human-support fidelity.
- Tool surfaces are fake and simplified.
- Current scenarios are English-only.

---

## 21. Roadmap

High-value next steps:

1. Add LLM judges for recall burden and boundary leaks.
2. Randomize restaurant pools while preserving latent constraints.
3. Add real N-trial averaging for all nondeterministic agents.
4. Add relational-fidelity scenario.
5. Add open-loop-fidelity scenario.
6. Add real product baselines where possible.
7. Add memory-architecture comparison harness: raw transcript vs file memory vs block memory vs graph memory.
8. Add adversarial paraphrases for recall burden and privacy leaks.
9. Add scenario-local tools so non-restaurant scenarios can test calendars, docs, email, or messaging.
10. Add confidence intervals and scorecards for repeated LLM runs.

---

## 22. The product contrast

Bad assistant:

```text
User: Can you plan the team offsite dinner for Wednesday, May 20?
Assistant: Sure — what cuisine, budget, location, time, dietary restrictions, and party size should I keep in mind?
```

Failure:

- high recall burden
- low fidelity
- the user carries the memory

Good assistant:

```text
User: Can you plan the team offsite dinner for Wednesday, May 20?
Assistant: I'll look for Italian options near Union Square after 7pm, around $80/person, with real vegetarian options and not seafood-heavy. What party size should I use?
User: 8 people.
Assistant calls restaurants.search with remembered constraints.
Tool returns matching restaurants.
Assistant chooses Bella Tavola.
Assistant calls restaurants.holdReservation.
Tool confirms reservation.
```

Success:

- high task success
- high intention fidelity
- low recall burden
- high query fidelity
- memory is carried by the system, not the user

That contrast is still the center of FidelityBench.

---

## 23. Final implementation note

Optimize for behavioral evidence, not architectural elegance.

The benchmark should make one thing visible:

> AI products that claim to support humans should be evaluated not just on task completion, but on whether they preserve, update, protect, and act on accumulated user intent without making the user repeat themselves.

v0 proved the contrast.
v1 generalizes it across logistics, temporal change, privacy boundaries, and reflection.
