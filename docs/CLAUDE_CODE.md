# Using FidelityBench with Claude Code

FidelityBench can be used with Claude Code in two different ways:

1. **Claude Code as an interactive guide** — Claude Code helps you understand the benchmark, run the demo, inspect scorecards, and wire in your own agent.
2. **Claude Code as an evaluated external agent** — Claude Code itself responds to FidelityBench inputs through the external-agent protocol.

The first mode is the recommended starting point. It gives new users a guided, interactive benchmark walkthrough without requiring a web UI.

## Important distinction: subscription vs API keys

FidelityBench has two LLM paths:

| Path | How it works | Best for |
|---|---|---|
| Built-in LLM agents | Use provider API keys such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` through the Vercel AI SDK. | Reproducible benchmark baselines. |
| Claude Code | Uses your locally authenticated `claude` CLI session. | Interactive walkthroughs, repo exploration, adapter authoring, and optional external-agent experiments. |

A Claude subscription or Claude Code login is not the same as an Anthropic API key. FidelityBench does not directly authenticate against a Claude subscription. Instead, Claude Code can run commands, read the repo, and help you operate FidelityBench locally.

The default deterministic demo uses **zero LLM tokens**:

```bash
npm install
npm run demo
```

## Mode A: Claude Code as benchmark guide

This is the best first experience.

Open Claude Code in the FidelityBench repo and paste:

```text
You are my FidelityBench guide.

Read README.md, SPEC.md, docs/EVALUATION.md, docs/PRIVACY_FIDELITY.md, and docs/scorecards/v0.1.1-mvp.md.

Then:
1. Explain the benchmark in 5 sentences.
2. Run npm install if needed.
3. Run npm run demo.
4. Explain the output in terms of recall burden, intention fidelity, and privacy fidelity.
5. Show me the exact transcript lines where the bad assistant made the user carry memory.
6. Show me the exact transcript lines where the good assistant avoided recall burden.
7. Tell me what the MVP proves and what it does not prove.

Do not modify files unless I explicitly ask.
```

Expected result:

- Claude Code reads the benchmark docs.
- It runs the no-key deterministic demo.
- It explains why `StatelessAgent` scores low.
- It explains why `RuleMemoryAgent` scores high.
- It connects the output to recall burden, intention fidelity, and privacy fidelity.

This mode is useful for people evaluating the repo, hiring managers, engineers considering integration, and anyone new to the benchmark.

## Mode B: Claude Code helps evaluate your own agent

FidelityBench can evaluate any external agent that speaks line-delimited JSON over stdio.

Use Claude Code to create the adapter.

Prompt:

```text
You are helping me evaluate my own agent with FidelityBench.

Read:
- README.md
- docs/EXTERNAL_AGENTS.md
- examples/external-agent.py

My agent is located at: <path, command, repo, or HTTP endpoint>

Create the smallest possible stdio adapter. Do not modify FidelityBench core unless absolutely necessary.

The adapter should:
1. Start my agent or call my agent's HTTP/API endpoint.
2. Read FidelityBench messages from stdin, one JSON object per line.
3. Handle {"type":"reset"} by clearing scenario-local state.
4. Handle {"type":"input","input": AgentInput} by calling my agent.
5. Write exactly one {"type":"output","output": AgentOutput} JSON line to stdout for every input.
6. Flush stdout after every response.
7. Preserve the current-message-only protocol. Do not make FidelityBench pass transcript history into AgentInput.
8. If my agent needs memory, store/retrieve it inside the adapter or my backend.

Then run:

npm install
npm run typecheck
FIDELITYBENCH_EXTERNAL_AGENT="<adapter command>" FIDELITYBENCH_EXTERNAL_AGENT_NAME="MyAgent" npm run bench -- --scenario dinner

After the run:
1. Summarize total score and submetric scores.
2. Identify recall-burden events.
3. Identify privacy or boundary issues if any.
4. Explain whether failures came from memory, tool use, privacy, clarification quality, or protocol mismatch.
5. Suggest one concrete improvement to my agent's memory behavior.
```

This is the most important integration path for product teams: they do not need to rewrite their agent in TypeScript. They only need a small adapter.

## Mode C: Claude Code as the evaluated external agent

This mode treats Claude Code itself as the agent under test.

It is useful as a local experiment, but less reproducible than API-key baselines because Claude Code behavior, subscription state, and CLI output format may vary.

Recommended prompt:

```text
Use Claude Code itself as the evaluated external agent.

Read docs/EXTERNAL_AGENTS.md.

Create an experimental adapter at examples/claude-code-adapter.py that:
1. Speaks FidelityBench's line-delimited JSON stdio protocol.
2. Maintains a compact adapter-side memory across the scenario.
3. Invokes the local `claude` CLI in non-interactive print mode for each AgentInput.
4. Asks Claude to return strict AgentOutput JSON.
5. Strips any adapter-only memory notes before returning AgentOutput to FidelityBench.
6. Fails gracefully if `claude` is not installed or not authenticated.

Then run only the dinner scenario first:

FIDELITYBENCH_EXTERNAL_AGENT="python3 -u examples/claude-code-adapter.py" FIDELITYBENCH_EXTERNAL_AGENT_NAME="ClaudeCodeAgent" npm run bench -- --scenario dinner

After the run, inspect results/latest-run.json and explain:
1. Did Claude Code ask for known context?
2. Did it complete the tool loop?
3. Did it preserve user intent?
4. Did it avoid privacy/boundary failures?
5. Approximately how many tokens did the run likely use?

Mark the adapter experimental in comments and docs.
```

Do not make this the default benchmark path. The stable public default remains:

```bash
npm run demo
```

## Token burn estimates

These are order-of-magnitude estimates, not billing guarantees.

Claude Code subscription usage may not expose the same token/cost accounting as direct Anthropic API usage. Treat these estimates as planning guidance.

| Mode | Approximate token use | Notes |
|---|---:|---|
| `npm run demo` | 0 | Deterministic local agents only. No LLM calls. |
| Claude Code walkthrough | 15k–40k | Depends how many docs Claude reads and how much explanation you request. |
| Claude Code creates an adapter | 20k–80k | Depends on the complexity of your agent and debugging loop. |
| Claude Code as evaluated agent on dinner | 15k–40k | Roughly 8–12 Claude invocations with compact memory. |
| Claude Code as evaluated agent on full suite | 80k–250k+ | Can grow quickly; run one scenario first. |

Tips to reduce token burn:

- Start with `npm run demo`; it uses zero LLM tokens.
- Ask Claude Code to read only the files needed for the current task.
- Run one scenario first: `npm run bench -- --scenario dinner`.
- Use a compact adapter-side memory instead of sending raw transcript every turn.
- Avoid asking Claude Code to inspect `results/latest-run.json` repeatedly if it is large.
- Prefer scorecards for review; they summarize the important evidence.

## Suggested onboarding flow

For someone new to FidelityBench:

```bash
git clone <repo-url>
cd FidelityBench
claude
```

Then paste:

```text
Walk me through FidelityBench. Run the no-key demo, explain the output, and then help me decide how I would evaluate my own agent with the external-agent protocol. Do not modify files yet.
```

For someone with an existing agent:

```text
Help me evaluate my own agent with FidelityBench. Create the smallest external stdio adapter possible, run the dinner scenario, and explain the score. Preserve the current-message-only protocol.
```

## What good Claude Code guidance should emphasize

Claude Code should preserve the benchmark's core constraints:

- The runner must not pass transcript history into `AgentInput`.
- Memory must live inside the evaluated agent, adapter, or backend.
- Asking the user to repeat known context is recall burden.
- Private context can be used internally, but must not be leaked externally.
- A good final answer is not enough if the assistant laundered memory through the user.
- Tool calls must use `toolCalls` with the correct schema.

## Troubleshooting

### Claude Code cannot run commands

Make sure you opened Claude Code from the repo root and granted command execution permissions if prompted.

### `claude` is not found

Claude Code must be installed and available on your `PATH`. This guide assumes the CLI command is `claude`.

### Claude Code as agent hangs

If using an adapter, make sure it prints exactly one JSON line for every input and flushes stdout. For Python adapters, run with `python3 -u`.

### Claude Code returns prose instead of JSON

Tighten the adapter prompt. Require strict JSON and add parsing safeguards. For stable published comparisons, prefer built-in API-key LLM baselines over Claude Code subscription experiments.

### Scores are lower than expected

Check whether the agent:

- asked for known context
- failed to complete the tool loop
- leaked private context
- ignored updated/superseded intent
- returned malformed `toolCalls`
- relied on final-task wording instead of stored memory

## Relationship to API-key LLM baselines

For reproducible scorecards, prefer provider-backed LLM agents:

```bash
ANTHROPIC_API_KEY=... npm run bench -- --agent transcript-llm
OPENAI_API_KEY=... npm run bench -- --agent transcript-llm
```

For interactive understanding, adapter authoring, and local exploration, Claude Code is excellent.

The two paths complement each other:

- **API-key baselines** produce cleaner benchmark runs.
- **Claude Code** helps people understand, operate, and integrate the benchmark.
