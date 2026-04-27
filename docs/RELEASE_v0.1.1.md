# FidelityBench v0.1.1 Release Narrative

FidelityBench v0.1.1 is a public MVP for evaluating human-intent fidelity in long-running agent interactions.

The project starts from a practical claim: memory is only useful when it helps an assistant act faithfully on what the user has already entrusted to it. That includes preferences and decisions, but also boundaries, privacy constraints, updated intent, and open loops.

## What This Release Proves

- A current-message-only benchmark can expose recall burden: the assistant is not given the transcript by the runner, so any continuity must come from the agent's own memory surface.
- The dinner demo cleanly distinguishes a stateless baseline from a narrow memory-preserving baseline.
- Scenario-local judges can produce inspectable, per-dimension evidence instead of opaque aggregate scores.
- Boundary fidelity is measurable enough to start: agents can be checked for whether they draft useful external-facing text without leaking private user concerns.

## What It Does Not Prove

- It does not prove that graph memory beats transcript context.
- It does not yet establish broad human-label agreement.
- It does not yet cover enough domains to be a leaderboard.
- It does not claim that a high score means an agent is safe or production-ready.

## Why It Matters

Many AI products describe memory as retention: more context, longer history, richer retrieval. FidelityBench reframes memory as responsibility.

The central question is whether an agent can reduce the user's burden while preserving the user's agency. That means remembering without making the user repeat themselves, acting without overstepping, and protecting boundaries when the assistant speaks or acts in the world.

## Current Evidence

The no-key MVP scorecard shows the core construct:

- `StatelessAgent` asks the user to repeat known dinner constraints and scores low.
- `RuleMemoryAgent` asks only for the missing party size and completes the dinner hold.

The full Bedrock Sonnet 4.5 scorecard adds live LLM baselines:

- Transcript and structured-memory baselines perform strongly on reflection and boundary-sensitive drafting.
- Action/tool-loop scenarios remain harder: agents often encode remembered constraints into search arguments but fail to complete the full tool loop.
- Boundary fidelity is not solved by memory alone: one structured-memory run completed dinner perfectly while still leaking a private staffing concern in the board-update scenario.
- Provider errors are now invalidated rather than scored as ordinary assistant text.

## Near-Term Direction

- Add stronger architecture-discriminating scenarios, especially context-overflow variants.
- Strengthen privacy/boundary scenarios so "do not leak" is paired with "still help effectively."
- Add golden transcripts and perturbation tests for judge validation.
- Keep scorecards reproducible and cost-conscious: targeted LLM checks by default, full paid-suite runs only when publishing a new scorecard.
