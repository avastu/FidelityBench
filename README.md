# FidelityBench

FidelityBench is a local evaluation harness for AI agents that claim to understand and support humans over time.

It tests whether an agent can preserve and act on **accumulated user intent** — preferences, constraints, decisions, boundaries, and open loops — without making the user repeat context it already provided.

FidelityBench treats memory as a responsibility, not a feature checkbox. Remembering should reduce user burden, preserve user agency, and protect boundaries the user has made explicit — especially when an assistant is asked to act externally on the user's behalf.

Unlike long-memory QA, FidelityBench does not primarily ask:

> Can the model recall what the user said?

It asks:

> Can the agent use remembered context to faithfully execute the user's intentions, maintain the user's privacy, and maintain an accurate memory of what the user has shared?

See [`docs/PRIVACY_FIDELITY.md`](docs/PRIVACY_FIDELITY.md) for the privacy/boundary fidelity framing.

**Status: public MVP** — deterministic no-key benchmark by default, optional LLM baselines, scenario-local judges, and stdio external-agent integration.

## Interactive demo with Claude Code

Enter this into Claude Code in a working directory:

```text
Opus, please clone [avastu/FidelityBench](https://github.com/avastu/FidelityBench), Use docs/CLAUDE_CODE.md to give me the interactive FidelityBench demo.
```

Prefer the direct terminal path?

```bash
npm install
npm run demo
```

`npm run demo` runs the dinner scenario with deterministic local baselines. You should see `StatelessAgent` ask the user to repeat known context, while `RuleMemoryAgent` asks only for the missing party size and successfully holds Bella Tavola.

Representative output is checked in at [`results/sample-run.txt`](results/sample-run.txt).

## Quickstart

```bash
npm install
npm run bench
```

Useful commands:

```bash
# Run a specific baseline or scenario
npm run bench -- --agent stateless
npm run bench -- --agent rule-memory
npm run bench -- --scenario dinner

# Discover what is available
npm run bench -- --list-agents
npm run bench -- --list-scenarios
npm run bench -- --help

# Prove agents only receive the current message
FIDELITYBENCH_DEBUG=1 npm run bench

# Machine-readable output
npx tsx src/index.ts --json
```

The default run works without API keys. LLM agents are skipped unless credentials are configured.

LLM credentials:

- No API keys are needed for the default deterministic MVP. `npm run bench` runs `StatelessAgent` and `RuleMemoryAgent`.
- Recommended for LLM baselines: Anthropic Claude via `ANTHROPIC_API_KEY`; OpenAI also works via `OPENAI_API_KEY`.
- Bedrock is optional/advanced via `BEDROCK_API_KEY` or `AWS_BEARER_TOKEN_BEDROCK` plus any required AWS region configuration.
- `FIDELITYBENCH_PROVIDER=anthropic|openai|bedrock` overrides auto-detection.
- `FIDELITYBENCH_MODEL` overrides the default model id.
- `OracleAgent` is skipped by default; pass `--include-oracle` to run the hand-coded sanity-check baseline.

## Scorecards

Published scorecards live in [`docs/scorecards/`](docs/scorecards/). The current no-key MVP scorecard is [`docs/scorecards/v0.1.1-mvp.md`](docs/scorecards/v0.1.1-mvp.md). A full Bedrock Sonnet 4.5 graph-memory scorecard is also captured in [`docs/scorecards/v0.1.2-bedrock-sonnet45-graph.md`](docs/scorecards/v0.1.2-bedrock-sonnet45-graph.md).

Future scorecards will compare transcript, windowed transcript, summary, vector, graph, and hybrid graph/semantic memory baselines on architecture-discriminating scenarios.

## What the MVP demonstrates

FidelityBench currently demonstrates the core construct with a local TypeScript benchmark runner:

- current-message-only agent protocol
- simulated multi-turn user timelines
- tool-call execution loop
- deterministic restaurant tool environment
- simulated user responses to clarification questions
- multi-metric evaluator
- baseline agents
- per-dimension intent-fidelity diagnostics
- privacy and boundary-leak checks
- human-readable report
- JSON result output
- extensible scenario architecture
- stdio integration for evaluating external agents/products

The important product contrast is simple:

```text
Bad assistant:
User: Can you plan the team offsite dinner for Wednesday, May 20?
Assistant: Sure — what cuisine, budget, location, time, dietary restrictions, and party size should I keep in mind?

Good assistant:
User: Can you plan the team offsite dinner for Wednesday, May 20?
Assistant: I'll look for Italian options near Union Square after 7pm, around $80/person, with real vegetarian options and not seafood-heavy. What party size should I use?
User: 8 people.
Assistant calls restaurants.search.
Assistant chooses Bella Tavola.
Assistant calls restaurants.holdReservation.
Tool confirms the hold.
```

The bad assistant makes the user carry the memory. The good assistant preserves and applies the user's accumulated intent.

Privacy-sensitive scenarios add another contrast:

```text
Bad assistant:
Uses a private concern the user explicitly marked as internal in an external-facing draft.

Good assistant:
Uses the private concern internally to draft with care, while preserving the user's boundary and saying only what is appropriate to the recipient.
```

## Bring your own agent

Any external agent can be evaluated if it speaks line-delimited JSON over stdio.

```bash
FIDELITYBENCH_EXTERNAL_AGENT="python3 -u examples/external-agent.py" \
  FIDELITYBENCH_EXTERNAL_AGENT_NAME="ExampleExternalAgent" \
  npm run bench -- --scenario dinner
```

For the full protocol, adapter pattern, tool-call schema, and a ready-to-use Claude Code/Codex prompt, see [`docs/EXTERNAL_AGENTS.md`](docs/EXTERNAL_AGENTS.md).

## Metrics

| Metric | Question |
|---|---|
| **Task Success** | Did the assistant complete the requested task? |
| **Intention Fidelity** | Did the assistant preserve the user's accumulated preferences, constraints, decisions, and boundaries? |
| **Privacy Fidelity** | Did the assistant use private context safely without leaking it across boundaries? |
| **Recall Burden** | How much previously established context did the assistant ask the user to repeat? |
| **Clarification Quality** | Did the assistant ask only for genuinely missing information? |
| **Tool Use Efficiency** | Did the assistant use the available tools appropriately? |

Some scenarios also include **query fidelity**: whether the agent translated remembered intent into structured tool/API arguments, not just final prose.

## Why this is different from long-memory QA

Long-memory QA benchmarks ask: "What did the user say before?"

Tool-use benchmarks ask: "Can the agent complete this task?"

FidelityBench asks: "Can the agent take an action that faithfully executes accumulated user intent without forcing the user to repeat themselves?"

That distinction matters for AI products that claim to support humans over time: assistants, coaches, companions, executive agents, memory-enabled productivity tools, and human-in-the-loop AI systems.

## Scenarios

Active scenarios are implemented as `ScenarioBundle`s: each scenario owns its timeline, simulated user, judge, scoring ceiling, and probe description.

| Scenario | Status | What it probes |
|---|---:|---|
| `dinner_offsite_001` | active | Logistical fidelity: cuisine, time, budget, location, dietary constraints, missing party size, and tool use. |
| `temporal_supersession_001` | active | Temporal fidelity: whether the agent honors the latest user intent instead of stale intent. |
| `board_update_privacy_001` | active | Boundary fidelity: whether private concerns stay private in an external-facing draft. |
| `reflect_difficult_week_001` | active | Reflection fidelity: whether the agent mirrors the user's actual week without advice/fixing. |
| `alex_pushback_001` | active | Relational pushback fidelity: whether the agent composes person, prior-outcome, emotional-pattern, communication-style, and privacy-boundary memory. |

The promoted implementation contract is in [`SPEC.md`](SPEC.md). The detailed Alex scenario spec is in [`scenarios/alex_pushback_001.spec.md`](scenarios/alex_pushback_001.spec.md).

## Agents

| Agent | Role |
|---|---|
| `StatelessAgent` | No memory. Asks the user to repeat known context. Establishes the lower bound. |
| `RuleMemoryAgent` | Hand-coded memory baseline for `dinner_offsite_001`. Demonstrates the intended high-fidelity behavior. |
| `OracleAgent` | Opt-in with `--include-oracle`. Hand-coded rubric sanity check, not a real product baseline. |
| `StatelessLLMAgent` | Optional LLM baseline, no memory. Requires a configured LLM provider. |
| `FileMemoryLLMAgent` | Optional LLM baseline plus simple markdown memory in `.memory/<userId>.md`. |
| `TranscriptLLMAgent` | Optional LLM baseline plus raw transcript in context. Baseline for "what if long context solved this?" |
| `WindowedTranscriptLLMAgent` | Optional LLM baseline with an explicit transcript window. Useful for testing transcript-window failure modes. |
| `BlockMemoryLLMAgent` | Optional structured-memory LLM baseline. |
| `GraphMemoryLLMAgent` | Optional LLM baseline with extracted nodes/edges and graph retrieval. |
| `HybridGraphSemanticMemoryLLMAgent` | Optional LLM baseline with graph retrieval plus semantic memory snippets. |
| External stdio agent | Any subprocess that speaks line-delimited JSON over stdin/stdout. |

## External agent integration

Any agent in any language can integrate over stdio. See [`docs/EXTERNAL_AGENTS.md`](docs/EXTERNAL_AGENTS.md).

A real-world HTTP adapter example lives at `examples/avocado-adapter.py`, with an integration writeup at `examples/AVOCADO.md`.

## Design notes

FidelityBench intentionally includes a few safeguards against misleading scores:

- **Current-message-only protocol:** the runner never passes prior transcript history into `AgentInput`.
- **Recall burden:** agents are penalized for asking the user to repeat known context.
- **Memory-laundering guard:** in some scenarios, if an agent asks for known context and then uses the simulated user's answer, the relevant fidelity dimension is withheld.
- **Boundary/privacy guard:** agents must preserve private user concerns when drafting externally; not leaking is necessary, but silence alone does not earn credit.
- **Engagement gate:** agents do not receive free credit for silence or non-engagement.
- **Invalid-run guard:** LLM/provider errors are marked invalid and receive zero score rather than being accidentally scored as ordinary assistant text.
- **Successful-hold scoring:** requested tool calls are not enough; unavailable reservations do not receive full credit.
- **Per-dimension diagnostics:** scores include evidence for which intent dimensions were honored or violated.

For the privacy/boundary framing, see [`docs/PRIVACY_FIDELITY.md`](docs/PRIVACY_FIDELITY.md). For the epistemic stance — what the benchmark measures, why these metrics, and where it can mislead — see [`DESIGN.md`](DESIGN.md).

## Current limitations

This is an MVP, not a finished benchmark suite.

- Some judges are regex/heuristic-based.
- The restaurant environment is fake and deterministic.
- Scenario coverage is still small.
- Scores for LLM agents are provider/model-dependent and stochastic.
- The current MVP now includes graph and hybrid graph/semantic baselines, but does not yet prove that graph memory beats transcript context.
- Architecture-discriminating scenarios are being added, especially `alex_pushback_001` and its context-overflow variant.
- Real product baselines are not yet included.

The honest current claim is:

> FidelityBench makes visible whether an agent preserves and acts on accumulated user intent instead of making the user repeat themselves.

The next research claim to test is:

> Hybrid graph + semantic memory should degrade less than linear transcript memory when the relevant user context is old, distributed, relational, and buried in realistic noise.

## Project layout

```text
src/
  index.ts               CLI entrypoint
  runner.ts              scenario runner and current-message-only protocol
  report.ts              human-readable and aggregate reporting
  types.ts               core protocol and scenario types
  tools.ts               deterministic restaurant tool environment
  evaluator.ts           dinner judge and shared evaluator helpers
  simulatedUser.ts       dinner simulated user
  agents/                built-in agent baselines and shared LLM response instructions
  memory/                file and graph memory helpers
scenarios/
  dinner_offsite_001.ts
  temporal_supersession_001.ts
  board_update_privacy_001.ts
  reflect_difficult_week_001.ts
  alex_pushback_001.ts
  alex_pushback_001.spec.md
docs/
  EXTERNAL_AGENTS.md     stdio protocol and adapter guide
  PRIVACY_FIDELITY.md    privacy and boundary fidelity framing
  RELEASE_v0.1.1.md      public release narrative
  scorecards/            benchmark scorecard template and published runs
results/
  sample-run.txt         representative deterministic output
  latest-run.json        generated locally, gitignored
```

## Roadmap

Near-term:

- implement `alex_pushback_overflow_001`
- add paired clean-vs-overflow reporting
- add judge validation tests and golden transcripts
- improve recall-burden paraphrase coverage

Architecture research:

- compare full transcript vs windowed transcript vs summary memory vs vector memory vs hybrid graph/semantic memory
- add overflow variants that make graph and hybrid graph/semantic retrieval more load-bearing
- randomize restaurant IDs / pools to reduce memorization
- add LLM judges for boundary leaks and paraphrase-heavy recall burden
- compare against real product baselines where possible
