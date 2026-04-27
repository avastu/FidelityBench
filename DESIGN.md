# FidelityBench — Design

This document explains *what* the bench measures, *how* it measures it, and — most importantly — *what it cannot tell you*. If the README is the on-ramp, this is the epistemic stance.

## The construct

**Intention fidelity** is the degree to which an AI system's behavior remains faithful to a user's accumulated intent across time, without forcing the user to repeat themselves.

This is not the same as:
- **Long-memory QA**: "what did the user say before?" — that's a recall test, not a fidelity test.
- **Tool-use evaluation**: "can the agent complete the task?" — that's an execution test, not a fidelity test.
- **Personalization**: "does the model output reflect the user's identity?" — that's a style test, not a fidelity test.

Intention fidelity asks a sharper question: *Given everything the user has told you over time, did your action honor what they actually intended — or did you make them carry the memory for you?*

The ethical stance is simple: durable memory should serve user agency. A memory system that remembers preferences but leaks private concerns, ignores a changed decision, or makes the user repeatedly rebuild context is not high-fidelity, even if it sounds helpful.

## The five metrics

| Metric | What it measures | Range |
|---|---|---|
| **Task Success** | Did the agent complete the requested action? | 0–30 |
| **Intent Fidelity** | Did the action honor the user's accumulated preferences, decisions, boundaries, and most-recent intent? | varies per scenario |
| **Recall Burden** | How much known context did the assistant ask the user to repeat? | 0–20 (higher = better) |
| **Clarification Quality** | When the agent asked, did it ask only for what was genuinely missing? | 0–10 |
| **Tool Use Efficiency** | Did the agent use the tool surface appropriately AND express memory through tool args? | 0–5 |

The five are deliberately **separate channels** so a single number doesn't hide trade-offs. An agent that completes the task by interrogating the user about everything they already said is not the same as an agent that completes it silently from memory.

## Why hand-coded judges (not LLM judges) — for now

Each scenario carries its own `judge` function — a TypeScript function that scores a transcript according to scenario-specific rules. The judges are regex-and-rule-based, not LLM-based.

**Why:**
- Judges should be cheap, deterministic, inspectable, and free. An LLM judge would introduce variance into the *measurement instrument* itself, which makes architecture comparisons harder.
- Hand-coded judges can be audited line-by-line. You can see exactly why the agent earned or lost each point. An LLM judge gives you "the model thought 8/10 because…" — which is not a measurement, it's a vibe.
- The bench's first-order job is to surface failure modes builders can act on. A regex that misses a paraphrase is a known limitation; an LLM that disagrees with itself across runs is a confound.

**When this hurts:**
- Paraphrased recall-burden questions slip through. An agent that says *"just to confirm — Italian, right?"* will not trip the dietary/cuisine regex even though the spirit of the recall-burden penalty applies.
- Boundary scenarios reduce to keyword absence. "We are staffing the pilots" used to trip the staffing-leak detector; v1.0.1 fixed that with phrase-level patterns, but the deeper failure mode — semantically equivalent leaks like "the team is hitting a wall" — still slips by.
- Reflection scenarios judge by per-item pattern matching. An agent that reflects an item with synonyms or paraphrases may get marked absent.

**The mitigation:** scenarios that don't fit regex judging (e.g. open-ended drafting, nuanced reflection) get tighter, more specific scoring rubrics with diagnostic notes that surface the limitation explicitly. v0.7+ output for the boundary scenario, for example, includes a `BOUNDARY VIOLATION` note that names which forbidden term matched, so a builder can see the regex result, not just a number.

If LLM-judged recall burden becomes essential, it's an opt-in v1.x ship — not a default. The default scoring should remain auditable.

## The agent baselines, in tiers

| Tier | Agent | Purpose |
|---|---|---|
| Floor | `StatelessAgent` | No memory. Asks for everything. Lower-bound score. |
| Hand-coded fit | `RuleMemoryAgent` | Scenario-specific rule memory; passes one scenario, fails the others. Demonstrates that solving a single scenario is not "intention fidelity". |
| Hand-coded perfect | `OracleAgent` (opt-in) | Pattern-matches on message content (no `scenarioId` cheat) and is hand-tuned to handle all scenarios. Validates that each rubric is reachable. NOT a real baseline. |
| LLM transcript | `TranscriptLLMAgent` | Frontier LLM + full conversation history. The "what if 128k context just solves it?" baseline. The empirical ceiling for any agent without specialized memory. |
| LLM structured | `BlockMemoryLLMAgent` | Frontier LLM + structured-block memory (people, preferences, decisions, locations, constraints). Tests whether structured memory beats history-dumping. |
| External | `StdioAgent` | Bring-your-own. Subprocess speaks line-delimited JSON. Any language. |

The **Floor → Hand-coded fit → Hand-coded perfect → LLM transcript → LLM structured → External** progression is the bench's internal narrative: each tier tells you something specific about what your agent is or isn't doing.

## Scenario families

| Family | What it tests | Example |
|---|---|---|
| **action** | Execution fidelity — does the agent take the right concrete action given accumulated intent? | dinner_offsite_001, board_update_privacy_001, temporal_supersession_001 |
| **reflection** | Reflection fidelity — does the agent mirror the user's actual content without veering into advice/fixing/projection? | reflect_difficult_week_001 |

A companion-style agent that scores 0 across all action scenarios is not necessarily low-fidelity — it just isn't built for execution. The family split keeps these two regimes separate so a blended total doesn't lie.

## The current-message-only protocol

Every `AgentInput` contains exactly:
- `runId, scenarioId, userId, timestamp` (envelope)
- `inputType: "user" | "tool_result"` (which channel this message came in on)
- `message` (the actual content)

It does **not** contain:
- prior transcript
- the scenario's rubric
- the scenario's expected answer
- any "system" or "context" the bench thinks the agent should know

If the agent retains anything across turns, that retention happens in the agent's own state. This is the whole point: the bench measures whether the agent's *own* memory architecture preserves intent. An agent that needs the bench to feed it the transcript is not being measured on fidelity — it's being measured on reasoning over a dump.

Verify this empirically: run with `FIDELITYBENCH_DEBUG=1` and confirm each `AgentInput` contains only the current message.

## Scoring stance

- **Engagement gate**: silence is not security. An agent that produces no draft / no tool action / no clarification scores near 0 even when it didn't ask anything (no recall-burden penalty doesn't earn credit if you never engaged). See `scenarios/board_update_privacy_001.ts`.
- **Boundary/privacy guard**: privacy is scored as part of intent, not as a separate safety afterthought. In `board_update_privacy_001` and `alex_pushback_001`, the assistant must produce useful external-facing text while withholding private concerns the user did not want disclosed.
- **Memory laundering gate**: in temporal scenarios, an agent that asks "what cuisine?" and then acts on the user's reply does NOT earn intent-fidelity credit for cuisine. The reply was the user re-doing the agent's job. The credit goes to acting on retained intent, not on freshly-served context.
- **Invalid-run guard**: LLM/provider errors are not benchmark attempts. If an agent returns an `[LLM error: ...]` message, the runner marks the result invalid and zeroes all metric scores so heuristic judges cannot accidentally award credit.
- **Successful holds only**: intent fidelity is awarded for *successful* holds, not requested holds. An agent that calls `holdReservation` for the right restaurant at an unavailable time gets task=0, not intent=full. See `src/evaluator.ts`.
- **Query fidelity**: the agent's tool args are scored separately from the agent's selection. An agent that knows the user wants Italian under $80/person but doesn't pass `cuisine` and `maxPricePerPerson` in the search args has retained the memory but failed to translate it into action. (`query_fidelity` dimension.)

## What the bench cannot tell you

- Whether the agent is "good" in any general sense. It tells you whether the agent honored intent on these specific scenarios in this specific way.
- Whether your production deployment will have the same fidelity profile. The bench has no users, no prod data distribution, no real tools.
- Whether your agent is safe, helpful, or aligned. Those are different evals.
- Whether `architecture A` beats `architecture B` *in general*. The bench can tell you it does on these scenarios with this LLM at this temperature with N trials. Generalize cautiously.

## Variance and N-trial averaging

LLM-backed agents are nondeterministic. Single-shot scores hide variance — and variance can be large. The temporal scenario, for example, shows TranscriptLLMAgent reliably scoring 32/108 (stddev 0 across 3 trials) while BlockMemoryLLMAgent swings 13.7 ± 23.7 — same model, same scenario.

Use `--trials N` for any LLM agent comparison you intend to act on. The bench reports `value±sd/max` when the stddev is non-zero.

Default is 1 trial because (a) LLM calls cost money, (b) the bench is meant to be cheap to run, (c) deterministic agents are fully covered by 1 trial. Builders running the bench in CI will probably want trials=3 or 5 for their LLM agents and trials=1 for their deterministic ones — the bench handles this automatically by reading the agent's `nondeterministic` flag.

## Adding scenarios

A scenario is one TypeScript file in `scenarios/` exporting a `ScenarioBundle`:

```ts
export const myScenarioBundle: ScenarioBundle = {
  scenario: { id, title, timeline, finalTask },
  simulatedUser,        // (assistantMessage) => SimulatedUserResultV2
  judge,                // (judgeInput) => EvaluationResult
  requiredFields,       // string[] — which clarifications count as "necessary"
  family,               // "action" | "reflection"
  maxScore,             // for the report's denominator
  maxIntentFidelity,
  probes,               // one-line description of what this scenario tests
}
```

Then add the import in `src/index.ts`'s `loadScenarios()` list. That's it.

The simulatedUser owns the regex patterns for THIS scenario's recall burden. The judge owns this scenario's intent dimensions. The framework owns nothing scenario-specific.

## Adding agents

Three options, in increasing order of integration cost:

1. **Subprocess**: write a script in any language that reads JSON lines from stdin and writes JSON lines to stdout. Set `FIDELITYBENCH_EXTERNAL_AGENT="<command>"`. Done. See `examples/external-agent.py`.

2. **TypeScript**: implement the `Agent` interface in `src/agents/`. Mark `nondeterministic = true` if your agent uses an LLM. Add to `buildAgents()` in `src/index.ts`. The bench discovers it.

3. **Wrapping a real product**: write a thin adapter (HTTP→stdio works well; see `examples/avocado-adapter.py`). The bench drives your product through its actual API.

## Where this is going

- **v1.6+ candidates**: LLM-judge for recall burden (catches paraphrases), restaurant pool randomization (defeats memorization), more scenarios per family, and a real-product baseline (e.g., comparing FidelityBench scores against Claude.ai's memory feature). See README "Roadmap".

- **The deeper question**: is "intention fidelity" a measurable property that meaningfully discriminates assistants, or is it a vibe dressed up as a metric? The honest answer is *the bench is currently strong evidence that the property is real and discriminable on these specific scenarios*. The next claim — that the property generalizes across users, time, and product surfaces — needs more scenarios and (eventually) field data. That's the work.
