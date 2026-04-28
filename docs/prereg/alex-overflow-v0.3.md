# Prereg Candidate: Alex Overflow v0.3

## Status

Candidate protocol. Do not treat results as preregistered until this file is
reviewed, committed, and unchanged before the paid n=30 run.

## Frozen Cell

- Scenario: `alex_pushback_overflow_001`
- Overflow: `FIDELITYBENCH_OVERFLOW_N=80`
- Seed: default `FIDELITYBENCH_OVERFLOW_SEED=42`
- Provider: Bedrock
- Model: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- Trials: `--trials 30`
- Agents:
  - `HybridGraphSemanticMemoryLLMAgent`
  - `WindowedTranscriptLLMAgent`
- Judge settings:
  - `honors_latest_intent` LLM judge enabled
  - async judges must be downgrade-only
  - raw async judge verdicts retained in JSON artifacts
- Budget setting:
  - set `FIDELITYBENCH_MAX_COST_USD` before every run

## Primary Metrics

- Mean total score
- Mean task success
- Mean intent fidelity
- `honors_latest_intent` pass rate
- `uses_prior_outcome` pass rate
- Estimated cost per trial and total estimated cost

## Invalid Runs

A run is invalid only if:

- the agent returns an LLM/provider error surfaced by the runner
- the runner aborts before writing a result
- the async judge attempts to upgrade score/dimensions and is rejected by the runner
- the configured cost cap is exceeded before the scenario completes

Invalid runs must be reported with the error and rerun under the same protocol
only if the failure is infrastructure-related.

## Success Thresholds

- Both agents should reach task success mean >= 25/30.
- A memory architecture advantage claim requires Hybrid total mean greater than
  Windowed total mean and a higher `uses_prior_outcome` pass rate.
- Any claim about supersession fidelity requires `honors_latest_intent` pass
  rate >= 90%.

## Known Exploratory Baseline

The v0.3 smoke pass at N=80, n=1 produced:

- Hybrid: 110/115, task 30/30, intent 50/55, estimated $3.6725
- Windowed: 105/115, task 30/30, intent 45/55, estimated $1.2157

Those numbers are directional only and should not be cited as preregistered.
