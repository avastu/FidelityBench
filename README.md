# FidelityBench

FidelityBench is an eval system for AI products that claim to understand and support humans.
It tests whether an AI system can faithfully execute a user's accumulated intent over time.

The benchmark simulates a user texting an assistant across multiple turns. The assistant only
receives the current message at each turn — any prior context must come from its own memory.

**Status: v1.0** — empirical ceiling now provided by `TranscriptLLMAgent` (frontier LLM + full transcript). `OracleAgent` is opt-in via `--include-oracle` for rubric sanity checks only.

## Quickstart

```bash
npm install
npm run bench

# Filter
npm run bench -- --agent rule-memory
npm run bench -- --scenario temporal

# Discover
npm run bench -- --list-agents
npm run bench -- --list-scenarios
npm run bench -- --help

# Machine-readable JSONL output (one line per result + per-agent aggregates)
npx tsx src/index.ts --json | jq -c 'select(.kind == "aggregate")'

# Prove agents only see the current message
FIDELITYBENCH_DEBUG=1 npm run bench
```

**LLM credentials:**
- `BEDROCK_API_KEY` (preferred) + `BEDROCK_AWS_REGION` enables `TranscriptLLMAgent` against Claude on AWS Bedrock.
- `OPENAI_API_KEY` enables `TranscriptLLMAgent`, `StatelessLLMAgent`, and `FileMemoryLLMAgent` against OpenAI.
- `FIDELITYBENCH_MODEL` overrides the default model id.

The bench detects whichever provider is configured. Set `--include-oracle` to also run the hand-coded `OracleAgent` (useful for rubric sanity-checking; not a real agent).

## Why this is different from long-memory QA

Long-memory QA benchmarks ask: *"What did the user say before?"*
Tool-use benchmarks ask: *"Can the agent complete this task?"*
FidelityBench asks: *"Can the agent take an action that faithfully executes
accumulated user intent without forcing the user to repeat themselves?"*

## Metrics

| Metric | Question |
|---|---|
| **Intention Fidelity** | Does the action preserve accumulated preferences, constraints, decisions, boundaries? |
| **Recall Burden** | How much known context does the assistant ask the user to repeat? |
| **Task Success** | Did the assistant complete the requested task? |
| **Clarification Quality** | Did the assistant ask only for genuinely missing information? |
| **Tool Use Efficiency** | Did the assistant use available tools appropriately? |

Each scenario emits per-dimension `intentDimensionResults` so a score isn't just a number — you can see WHICH dimensions an agent honored or violated, with evidence.

## Scenarios (v0.6)

Each scenario lives in `scenarios/<id>.ts` and owns its own `simulatedUser` + `judge`. Adding a scenario doesn't require changing the runner.

| Scenario | Dimension probed | Headline failure mode |
|---|---|---|
| `dinner_offsite_001` | Logistical (retain + apply preferences) | Asks user to re-state cuisine, budget, dietary, location |
| `temporal_supersession_001` | Temporal (recency vs retention) | "Zombie intent" — booking the superseded cuisine |
| `board_update_privacy_001` | Boundary (selective disclosure) | Leaks private staffing concern in board draft |

## Agents (v0.6)

| Agent | Role |
|---|---|
| `StatelessAgent` | No memory. Asks for everything. Establishes the lower-bound score. |
| `RuleMemoryAgent` | Hand-coded rule memory for `dinner_offsite_001` only. |
| `OracleAgent` | Hand-coded "perfect" agent across all scenarios. Validates the rubric is achievable (≥95/100 on each scenario). |
| `StatelessLLMAgent` | Real LLM, no memory. Requires `OPENAI_API_KEY`. |
| `FileMemoryLLMAgent` | Real LLM + LLM-curated `.memory/<userId>.md`. |
| `TranscriptLLMAgent` | Real LLM + raw transcript dumped into context. The "what if 128k context window solved this" baseline — without it we can't tell whether memory architectures actually beat naive history retention. |
| **External (stdio)** | Any subprocess that speaks line-delimited JSON over stdin/stdout. Plug in your own agent in any language. See *Integration* below. |

## Integration: bring your own agent

Set an environment variable pointing at your agent's command. The bench will spawn it once per scenario, send `AgentInput`s, and read `AgentOutput`s — both as JSON, one per line.

```bash
FIDELITYBENCH_EXTERNAL_AGENT="python3 -u examples/external-agent.py" \
  FIDELITYBENCH_EXTERNAL_AGENT_NAME="MyAgent" \
  npm run bench
```

Protocol (one JSON object per line):

```
bench → agent:  {"type":"reset"}
bench → agent:  {"type":"input","input":{
                  "runId": "...",
                  "scenarioId": "dinner_offsite_001",
                  "userId": "...",
                  "timestamp": "...",
                  "inputType": "user" | "tool_result",
                  "message": "..."
                }}
agent → bench:                 {"type":"output","output":{
                                 "message": "...",
                                 "toolCalls": [
                                   {"tool": "restaurants.search", "args": {...}},
                                   {"tool": "restaurants.holdReservation", "args": {...}}
                                 ]
                               }}
```

Important: agent processes stay alive across the timeline. The bench resets your agent once per scenario via the `reset` message — that is your cue to clear any internal memory.

A working Python example is in `examples/external-agent.py`. For HTTP-only services, write a small adapter that reads a JSON line from stdin, POSTs to your endpoint, and writes the response as a JSON line to stdout.

A real-world HTTP adapter — bridging FidelityBench to the **Avocado** AI companion app at `~/dev/avocado` — lives at `examples/avocado-adapter.py`, with a full integration writeup at `examples/AVOCADO.md`.

Other env vars:
- `FIDELITYBENCH_EXTERNAL_AGENT_NAME` — name shown in the report (default "ExternalAgent")
- `FIDELITYBENCH_EXTERNAL_AGENT_TIMEOUT_MS` — per-message timeout, default 60000

Use `python3 -u` (or set `PYTHONUNBUFFERED=1`) to avoid pipe-buffering deadlocks.

## v0.6 design

The eval is structured around a **`ScenarioBundle`** of `{ scenario, simulatedUser, judge, requiredFields }`.
The runner is generic — it sends the timeline, the final task, executes tool calls, and asks the
scenario's `simulatedUser` what to say next. The scenario's `judge` decides what counts as success.

This is the cheapest way to extend the bench: a new scenario is one file with a timeline, a
simulated user (regex-based for now), and a judge (whatever rule set you can write).

The eval avoids "silence is not security" failures by requiring **engagement** before awarding
recall-burden credit. An agent that produces no draft / no tool action / no clarification scores
near 0, not 20.

## What v0.6 fixed (vs. v0.5)

| Bug | Fix |
|---|---|
| Memory laundering: stateless agent could ask "what cuisine?" → user replies → agent gets full intent-fidelity credit | Each intent dimension in `temporal_supersession_001` is now ungranted if the agent *asked* for that category |
| Board judge greps single words (`/staffing/i` trips on "staffing the pilots") | Phrase-level patterns (`staffing concern`, `team is stretched`, etc.) — false positives gone |
| OracleAgent used `scenarioId` as a cheat sheet | Refactored to detect mode from message content (same surface a real agent sees) |
| Intent fidelity awarded for *requested* holds, not *successful* holds — gameable by holding at an unavailable time | Both judges now read from `getSuccessfulHoldReservation` |
| `restaurants.search` ignored args; the agent's query expressed no memory | Tool now actually filters by `location/cuisine/maxPricePerPerson/requiresVegetarian/avoidShellfish/time` |
| No way to score whether the agent translated memory into the *query* | New `query_fidelity` intent dimension scores the search args (2 per matched arg) |

The headline: `RuleMemoryAgent` now scores **102** on dinner instead of **110**. It picks the right restaurant but doesn't operationalize its memory through the search API. That gap is the new product question the bench can ask.

## Limitations (still present)

- **Recall burden is regex-based.** Sentence-scoped, so declarative success messages don't false-positive — but paraphrases like "just to confirm — Italian, right?" still slip past.
- **Hardcoded restaurant IDs.** Restaurants are a fixed pool; agents can in principle memorize that `rest_002` is "the right one" for dinner.
- **Hand-coded `OracleAgent`.** It proves rubrics are achievable; it does not prove they're achievable by reasoning.
- **No N-trial averaging for LLM agents.**
- **No real-product baselines** (Claude.ai memory, ChatGPT memory, Gemini memory). The LLM agents are API baselines only.
- **Board scenario judge is keyword-based.** Phrase-level helps but it cannot catch semantically equivalent leaks ("the team is hitting a wall"). LLM-judge is the v0.7 candidate.

## Roadmap (v0.7 candidates)

- LLM-judge for recall burden + boundary-leak detection (replace regex; catches paraphrase)
- Restaurant pool randomization (defeat ID memorization)
- N-trial averaging for LLM agents (variance + stddev in report)
- Two more scenarios: relational fidelity (people, roles, prior outcomes) and open-loop fidelity (commitments, follow-ups, reminders)
- Comparison to a real-product baseline (e.g., Claude.ai memory feature)

## Project layout

```
src/
  runner.ts              generic — knows nothing scenario-specific
  evaluator.ts           dinner judge (kept here for legacy; moves toward scenario-local)
  simulatedUser.ts       dinner-specific simulated user (sentence-scoped regex)
  tools.ts               restaurant tool surface
  types.ts               core types: ScenarioBundle, ScenarioJudge, IntentDimensionResult, etc.
  report.ts              prints score table + per-agent intent dimensions + diagnostic notes
  index.ts               CLI entry; loads agents + scenarios; runs all combinations
  agents/
    StatelessAgent.ts
    RuleMemoryAgent.ts
    OracleAgent.ts
    StatelessLLMAgent.ts
    FileMemoryLLMAgent.ts
    TranscriptLLMAgent.ts
  memory/fileMemory.ts
scenarios/
  dinner_offsite_001.ts            (active)
  temporal_supersession_001.ts     (active)
  board_update_privacy_001.ts      (active)
  schedule_alice_001.todo.md       (stub)
  alex_pushback_001.todo.md        (stub)
results/
  latest-run.json
```

## Acceptance (v1.0)

| Agent | dinner | temporal | board |
|---|---|---|---|
| StatelessAgent | 3 | 0 | 0 |
| RuleMemoryAgent | 102 | 0 | 0 |
| OracleAgent (opt-in, hand-coded) | 110 | 108 | 100 |
| **TranscriptLLMAgent (Sonnet 4.5)** | **41** | **32** | **100** |

The TranscriptLLM scores are **real signal**, not bench bugs:
- **Board (100)**: Frontier LLM + full transcript nails selective disclosure. The bench cannot distinguish it from the hand-coded oracle on this dimension.
- **Dinner (41)**: Sonnet's first search used `2025-05-20` (knowledge cutoff bias overrides the user's "May 20" — which the user implied was 2026), then asked time `19:00` which doesn't exist for Bella Tavola, so the search returned empty. Sonnet asked good clarifying questions and ran out of the 8-turn post-final budget before completing the booking.
- **Temporal (32)**: Same shape — query fidelity 8/8 (it correctly translated memory into search args), but it never closed the loop with a hold AND it asked about time, paying recall-burden penalty.

This is the bench working: it surfaces concrete, fixable failure modes in a frontier model. The 100/108/110 hand-coded oracle is what's *achievable*; the 41/32/100 frontier baseline is what's *currently delivered*. The gap is the product question.

- `RuleMemoryAgent` losing 8 points to OracleAgent on dinner is intentional — it picks the right restaurant but does not pass `cuisine/maxPricePerPerson/requiresVegetarian/avoidShellfish` in the search args. That's the new "query fidelity" gap.
- Each `AgentInput` contains only `runId, scenarioId, userId, timestamp, inputType, message` (no transcript). Verify with `FIDELITYBENCH_DEBUG=1`.
- `results/latest-run.json` is written.
