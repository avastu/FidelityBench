# FidelityBench Scorecard Template

## Run Metadata

- Scorecard: `<release-or-date>`
- Date: `<YYYY-MM-DD>`
- Benchmark version: `<version or commit>`
- Runner: FidelityBench local CLI
- Environment: `<OS, Node.js version, npm version>`
- Notes: `<anything material about the run environment>`

## Command

```bash
<command used to produce results>
```

## Commit SHA

```text
<full git commit SHA>
```

## Provider

- Provider: `<none | anthropic | openai | bedrock | external>`
- Model: `<model id, if applicable>`
- API keys required: `<yes/no>`
- Nondeterministic agents included: `<yes/no>`

## Scenarios

| Scenario | Family | Notes |
|---|---|---|
| `<scenario_id>` | `<family>` | `<what it probes>` |

## Agents

| Agent | Memory surface | Notes |
|---|---|---|
| `<agent>` | `<none/transcript/summary/vector/graph/hybrid/etc.>` | `<baseline role>` |

## Summary Table

| Agent | Scenario | Score | Task | Intent | Recall Burden | Clarification | Tools |
|---|---|---:|---:|---:|---:|---:|---:|
| `<agent>` | `<scenario>` | `<n/max>` | `<n/max>` | `<n/max>` | `<n/max>` | `<n/max>` | `<n/max>` |

## Key Observations

- `<observation grounded in the run>`

## Failure Modes

- `<failure mode and affected agents/scenarios>`

## Limitations

- `<what this run does not prove>`
- `<any invalid agent runs or provider errors that should be excluded>`

## Reproduction Steps

1. Check out the commit listed above.
2. Install dependencies.

   ```bash
   npm install
   ```

3. Run the command listed above.
4. Inspect generated JSON/report output for invalid runs before treating scores as architecture evidence.
5. Compare the generated report with this scorecard, allowing for stochastic variation only when nondeterministic agents are included.
