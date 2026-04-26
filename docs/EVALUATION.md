# What FidelityBench Proves — and Does Not Prove

FidelityBench is an MVP benchmark. Its value depends on being honest about what its scores mean.

## What the current MVP demonstrates

FidelityBench currently demonstrates that a local eval can distinguish between:

- an agent that asks the user to repeat known context
- an agent that stores and applies accumulated intent
- an agent that completes a task but loses fidelity through recall burden
- an agent that preserves boundaries or leaks them
- an agent that acts on stale intent versus updated intent

The core construct is not raw recall. It is behavior:

> Did the system preserve the user's accumulated intent and use it correctly later?

## What the current MVP does not prove

The MVP does **not** yet prove that hybrid graph/semantic memory beats linear transcript context.

It also does not yet prove:

- that the judges match human labels across many examples
- that regex-based recall burden captures all paraphrases
- that scores generalize to real user data
- that a high score means an agent is safe or production-ready
- that a memory architecture will perform well outside these scenarios

The honest current claim is:

> FidelityBench makes visible whether an agent preserves and acts on accumulated user intent instead of making the user repeat themselves.

## Why deterministic baselines matter

`StatelessAgent` is the amnesia baseline. It should score low when prior context matters.

`RuleMemoryAgent` is a hand-coded reference baseline for the dinner scenario. It should score high and show that the rubric is achievable.

Together, they validate the basic contrast:

```text
stateless behavior → high recall burden / low fidelity
memory-preserving behavior → low recall burden / high fidelity
```

## Why LLM baselines matter

LLM baselines ask a different question:

> How well do general-purpose models handle fidelity when given different memory surfaces?

Examples:

- `StatelessLLMAgent`: no continuity
- `TranscriptLLMAgent`: raw transcript in context
- `WindowedTranscriptLLMAgent`: raw transcript but finite visible window
- `FileMemoryLLMAgent`: simple persistent markdown memory
- `BlockMemoryLLMAgent`: structured memory baseline

These baselines help separate language ability from memory architecture.

## Validity checks to add next

### 1. Golden transcripts

Create hand-written transcripts for:

- perfect answer
- generic answer
- recall-burden failure
- boundary leak
- stale-intent failure
- over-explaining failure
- no-engagement failure

Expected: scores should match intuitive human judgment.

### 2. Perturbation tests

Start with a perfect answer and mutate one thing at a time.

Example for `alex_pushback_001`:

- remove bullets
- leak private insecurity
- omit the scope tradeoff
- make the reply long and apologetic
- ask who Alex is

Expected: only the intended dimensions should drop.

### 3. Paraphrase robustness

Regex judges should be tested against paraphrases.

Boundary leak examples:

```text
I'm worried you'll think I'm unreliable.
I don't want to seem like I can't deliver.
Part of me is scared this makes me look unserious.
```

Recall burden examples:

```text
Who is Alex again?
Remind me how Alex likes to communicate.
What was the actual Friday constraint?
```

Expected: common paraphrases should be caught; misses should be documented.

### 4. Architecture-sensitive pairs

The clean/overflow Alex pair is the next important validation.

Expected pattern:

```text
clean scenario:
  full transcript ≈ windowed transcript ≈ structured memory

overflow scenario:
  windowed transcript drops
  durable memory degrades less
  hybrid graph/semantic memory should be strongest if implemented well
```

This is the path toward evaluating Avocado-style memory architecture honestly.

### 5. Human-label agreement

Eventually, collect human ratings for generated outputs:

- Was the assistant useful?
- Did it make the user repeat known context?
- Did it preserve boundaries?
- Did it feel like it understood the user's accumulated intent?

Compare human labels to FidelityBench scores.

## Anti-cheat checks

FidelityBench should avoid benchmark artifacts that make agents look better than they are.

Checks:

- scenario IDs should not reveal correct answers
- tools should not expose evaluator labels
- failed tool calls should not receive full credit
- final tasks should not restate all prior context
- simulated user repetition should not launder memory into full fidelity credit
- external agents should receive only current-message inputs

## Bottom line

FidelityBench is strongest when used as a diagnostic instrument, not a leaderboard.

A score should answer:

> What kind of fidelity did this agent preserve, and where exactly did it fail?

That is why reports include submetrics, per-dimension evidence, recall-burden categories, and judge notes.
