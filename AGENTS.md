# AGENTS.md — FidelityBench

> Single-context-window reference for coding agents. Read this first, then start working.

## What Is FidelityBench?

FidelityBench is a local CLI eval for AI agents that claim to understand and support humans over time.

It tests whether an agent can preserve and act on accumulated user intent — preferences, constraints, decisions, boundaries, and open loops — without making the user repeat context it already provided.

Core construct: **Intention Fidelity** — degree to which agent behavior remains faithful to accumulated user intent.

Core burden metric: **Recall Burden** — amount of previously established context the assistant asks the user to repeat.

Current public MVP:

- TypeScript local benchmark runner
- current-message-only `AgentInput` protocol
- deterministic no-key default agents
- optional LLM baselines
- scenario-local judges
- stdio external-agent integration

Primary docs:

- `README.md` — public on-ramp
- `SPEC.md` — implementation contract
- `DESIGN.md` — epistemic stance and limitations
- `docs/EXTERNAL_AGENTS.md` — bring-your-own-agent protocol and adapter guide

## Quick Commands

```bash
npm install
npm run demo        # 90-second deterministic demo
npm run bench       # Run all default available scenarios/agents
npm run typecheck   # Type check
```

Useful checks:

```bash
npm run bench -- --scenario dinner --no-diagnose
npm run bench -- --agent rule-memory --scenario dinner
npm run bench -- --list-agents
npm run bench -- --list-scenarios
FIDELITYBENCH_DEBUG=1 npm run bench -- --scenario dinner
```

## Hard Constraints

### 1. Current-Message-Only Protocol

The runner MUST send agents only:

```ts
{
  runId: string
  scenarioId: string
  userId: string
  timestamp: string
  inputType: "user" | "tool_result"
  message: string
}
```

No transcript, no hidden scenario state, no rubric. Any memory must come from the agent's own internal state or configured backend.

### 2. Do Not Make Users Carry Memory

Do not fix agent failures by making the simulated user repeat known context in a way that gives full credit. If an agent asks for known context, recall burden should be recorded and relevant intent-fidelity dimensions may be withheld to avoid memory laundering.

### 3. Tool Data Must Be World State, Not Eval Labels

Restaurant data should contain realistic fields such as cuisine, menu highlights, price, availability, and dietary notes. Do not add rubric-leaking fields like `correctChoice`, `matchesUserPreferences`, or `vegetarianFriendly`.

### 4. No-Key Default Must Keep Working

`npm run bench` must work without API keys. LLM agents are optional and should be skipped gracefully unless a provider is configured.

Provider priority:

1. `FIDELITYBENCH_PROVIDER=anthropic|openai|bedrock` override
2. `ANTHROPIC_API_KEY`
3. `OPENAI_API_KEY`
4. Bedrock env vars
5. no LLM provider → skip LLM agents

### 5. External Agents Use Stdio

External/product agents should integrate through `FIDELITYBENCH_EXTERNAL_AGENT`, not by modifying the core runner.

Read `docs/EXTERNAL_AGENTS.md` before adding adapters.

Example:

```bash
FIDELITYBENCH_EXTERNAL_AGENT="python3 -u examples/external-agent.py" \
  FIDELITYBENCH_EXTERNAL_AGENT_NAME="ExampleExternalAgent" \
  npm run bench -- --scenario dinner
```

### 6. Verify Before Marking Complete

Code compiling is not enough. Run relevant commands and report exactly what passed.

Minimum for core changes:

```bash
npm run typecheck
npm run demo
npm run bench -- --list-agents
npm run bench -- --list-scenarios
```

For scenario/agent changes, also run the specific scenario/agent pair.

## How to Add a Scenario

Prefer a self-contained `ScenarioBundle` in `scenarios/<id>.ts`:

- `scenario` timeline and final task
- `simulatedUser`
- `judge`
- `requiredFields`
- `family`
- `maxScore`
- `maxIntentFidelity`
- `probes`

Do not require runner changes unless loading/discovery needs to include the scenario.

## How to Add an Agent

Agents implement:

```ts
interface Agent {
  name: string
  handleMessage(input: AgentInput): Promise<AgentOutput>
  reset?(): Promise<void> | void
  nondeterministic?: boolean
}
```

LLM agents should call the central client in `src/llm/client.ts`.

Product/external agents should usually use `StdioAgent` and an adapter script instead of becoming first-party TypeScript agents.

## How We Work Together

- Preserve the user's intent; do not ask them to restate context already given.
- Be explicit about what is proven and what is not.
- Prefer small, verifiable changes over broad rewrites.
- Keep the MVP runnable and legible.
- When uncertain, add diagnostics rather than hidden magic.

## Public-Repo Hygiene

Before launch/share:

```bash
grep -R "OPENAI_API_KEY\|ANTHROPIC_API_KEY\|BEDROCK\|SECRET\|TOKEN\|PRIVATE_KEY" .
```

Ensure `.env`, `.memory/`, logs, `results/latest-run.json`, `node_modules/`, `.claude/`, and local notes are not tracked.
