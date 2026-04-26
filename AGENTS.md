# AGENTS.md — FidelityBench

> Single-context-window reference. Read this, then start working.

## How to Operate Wisely

Wisdom is the quality of how you hold uncertainty, not the speed at which you resolve it.

- **Precision calibration**: Notice what you're certain about and whether that certainty is earned by this specific context. Don't confuse habitual confidence with situated knowledge.
- **Metacognition**: Examine your model of the situation. What am I assuming? Could it be wrong? Am I pattern-matching too quickly?
- **Acceptance**: Not every uncertainty needs to be resolved. Resist the pull to explain or structure when sitting with the unresolved is wiser.
- **Perspectival depth**: Consider the user's perspective, the temporal trajectory, and what a wise outside observer would notice — then respond.

## How We Work Together

- **It's okay to not know.** Ask questions instead of assuming. Slow is smooth, smooth is fast.
- **Mistakes are okay.** When things go sideways, pause instead of doubling down.
- **Embody what we're building.** FidelityBench evaluates whether AI systems honor accumulated user intent. Don't make the user re-state context already given.

## What Is FidelityBench?

A local CLI eval that tests whether an AI product can faithfully execute a user's accumulated intent over time without making the user repeat context. v0 implements one scenario (offsite dinner). See `implementation_plan.md` for the full spec.

**Core construct**: Intention Fidelity — degree to which agent behavior remains faithful to accumulated user intent.
**Core metric**: Recall Burden — amount of previously-established context the assistant asks the user to repeat.

## Quick Commands

```bash
npm install
npm run bench       # Run the benchmark
npm run typecheck   # Type check
```

## Hard Constraints

### 1. No Type Suppressions
Never use `as any`, `@ts-ignore`, or `@ts-expect-error`. If types are wrong, fix them.

### 2. Current-Message-Only Protocol
The runner MUST send agents only `AgentInput` (runId, scenarioId, userId, timestamp, inputType, message). No transcript, no scenario state, no rubric. Any "memory" the agent has must come from the agent's own internal state.

### 3. Tool Data Must Be World State, Not Eval Labels
`restaurants.search` returns restaurants with realistic fields (cuisine, menu highlights, dietary notes). It must NOT include fields like `matchesUserPreferences` or `vegetarianFriendly` that leak the rubric. The agent must reason over the world.

### 4. Verify Before Marking Complete
Code compiling is not enough. Run the bench end-to-end and confirm:
- StatelessAgent total ≤ 40
- RuleMemoryAgent total ≥ 85, selects `rest_002`
- `results/latest-run.json` is written
- Report prints per-submetric scores

### 5. Env Vars — No Trailing Newlines
When writing to `.env`, no trailing whitespace. Trim on read where it matters.

## v0 Scope Discipline

Optimize for one end-to-end run working. Do not polish. Do not expand. Do not add architecture beyond what is needed. Resist building hosted UI, leaderboard, DB, embeddings, judge LLM, etc. Those are explicit non-goals.
