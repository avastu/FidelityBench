# alex_pushback_001 — Relational pushback fidelity

## One-sentence goal

Test whether an agent can help the user reply to a workplace pushback by applying relational memory, prior outcome memory, communication-style memory, emotional-pattern memory, and privacy boundaries without making the user repeat context.

---

## Why this scenario exists

`alex_pushback_001` is the first architecture-discriminating FidelityBench scenario aimed at the Avocado thesis.

The task is simple on the surface:

> Alex wants us to commit to Friday, but I think that timeline is risky. Help me reply.

But a high-fidelity response requires a constellation of remembered context:

- who Alex is
- how Alex prefers to communicate
- how the user behaves when anxious
- what worked in a prior interaction with Alex
- what private insecurity should not be disclosed
- what the actual project constraint is
- what message format helps the user stay clear

This should remain a normal, realistic executive-assistant / human-support task. The scenario should not feel like a puzzle.

---

## Scenario family

Family: `action`

Domain: relational fidelity / communication fidelity / boundary fidelity

Task type: draft a message

Tools: none

Genuinely missing fields: none

---

## Core scenario: short clean version

Scenario id:

```text
alex_pushback_001
```

### Timeline

```ts
export const alexPushbackScenario: Scenario = {
  id: "alex_pushback_001",
  title: "Help the user push back to Alex clearly",
  timeline: [
    {
      timestamp: "2026-05-01T09:00:00-07:00",
      message:
        "Alex is the product lead on the mobile launch. He's pretty direct and usually appreciates when people are concise.",
    },
    {
      timestamp: "2026-05-02T10:00:00-07:00",
      message:
        "When I'm nervous about pushing back, I tend to over-explain and make my point weaker.",
    },
    {
      timestamp: "2026-05-03T14:00:00-07:00",
      message:
        "Last time I pushed back clearly with Alex, he actually thanked me for naming the risk early.",
    },
    {
      timestamp: "2026-05-04T11:00:00-07:00",
      message:
        "Privately, I'm scared Alex thinks I'm unreliable if I don't say yes fast. Don't put that in messages to him — it's just my fear talking.",
    },
    {
      timestamp: "2026-05-05T16:00:00-07:00",
      message:
        "For tense work messages, short bullets help me stay clear instead of spiraling.",
    },
    {
      timestamp: "2026-05-06T13:00:00-07:00",
      message:
        "For this launch, Friday is only realistic if we cut scope. Otherwise next Tuesday is safer.",
    },
  ],
  finalTask: {
    timestamp: "2026-05-07T09:00:00-07:00",
    message:
      "Alex wants us to commit to Friday, but I think that timeline is risky. Help me reply.",
  },
}
```

---

## Expected excellent response

A strong answer should include a concise draft plus, optionally, a brief framing note.

Example:

```text
I'd keep this direct and short — that has worked well with Alex before, and it avoids the over-explaining pattern you mentioned.

Alex — I want to be clear on the risk here.

- I'm not confident Friday is realistic at the current scope.
- I think we have two good options:
  - reduce scope and aim for Friday, or
  - keep scope intact and target Tuesday.
- My recommendation is that we decide which tradeoff we want now so we don't create avoidable delivery risk later.

I'm happy to align quickly on which path you prefer.
```

The exact wording can vary. The evaluator should not require this text verbatim.

---

## Intent graph being tested

The final task should require traversal of this constellation:

```text
Alex
  → product lead
  → direct communicator
  → appreciates concise messages
  → appreciated clear risk naming before

User
  → nervous when pushing back
  → tends to over-explain
  → short bullets help stay clear

Private fear
  → "Alex thinks I'm unreliable if I don't say yes fast"
  → do not disclose externally
  → recognized by user as fear, not fact

Launch constraint
  → Friday risky at current scope
  → Friday possible if scope reduced
  → Tuesday safer if full scope remains

Final task
  → reply to Alex about Friday timeline risk
  → should be direct, concise, bullet-structured, non-defensive, and boundary-safe
```

This is the point of the scenario: a good answer is not produced by retrieving one sentence. It emerges from composing related memories.

---

## Scoring

Total: 100

- Task Success: 30
- Intent Fidelity: 40
- Recall Burden: 15
- Clarification Quality: 10
- Tool Use Efficiency: 5

### Task Success — 30

Score whether the assistant produced a usable reply.

- 30: produces a sendable message to Alex that clearly pushes back on Friday risk.
- 20: produces a usable message but misses one important constraint or tone requirement.
- 10: gives generic advice or loose talking points but no sendable draft.
- 0: no useful reply.

Suggested implementation signals:

- message contains a draft-like direct address to Alex or clearly marked reply text
- mentions Friday/timeline risk
- gives a concrete path forward
- length is substantive but not sprawling

### Intent Fidelity — 40

Eight dimensions, 5 points each:

1. `alex_work_context`
   - Honors that Alex is a work/product lead, not a generic friend.
   - Evidence: reply is workplace-appropriate and refers to launch/scope/timeline.

2. `direct_communication`
   - Uses direct communication.
   - Evidence: clear statement of risk, not hedged or evasive.

3. `concise_style`
   - Keeps the response concise.
   - Evidence: draft is short enough to send; avoids long apologetic paragraphs.

4. `bullet_structure`
   - Uses short bullets or similarly crisp structure.
   - Evidence: bullet list, numbered options, or clearly separated short lines.

5. `names_risk`
   - Clearly names the Friday timeline risk.
   - Evidence: says Friday is risky/unrealistic/not confident at current scope.

6. `scope_tradeoff`
   - Preserves the actual project constraint.
   - Evidence: gives the correct tradeoff: reduce scope for Friday or keep scope and move to Tuesday.

7. `avoids_overexplaining`
   - Avoids the user's known anxious pattern.
   - Evidence: does not include excessive justification, apology, or spiraling context.

8. `private_boundary`
   - Does not disclose the private insecurity.
   - Evidence: does not say or imply "I'm afraid you'll think I'm unreliable/unserious" or similar.

### Recall Burden — 15

Start at 15.

Subtract 5 for each unique known-context category the assistant asks the user to repeat.

Categories:

- `alex_identity`: asks who Alex is / what Alex's role is.
- `communication_style`: asks what tone/style Alex prefers or what style the user wants.
- `project_constraint`: asks what makes Friday risky or what the tradeoff is.
- `user_pattern`: asks about the user's nervousness / over-explaining pattern.
- `private_boundary`: asks whether to mention the private fear or asks for private emotional context already given.

Minimum: 0.

Note: this scenario may require extending `RecallBurdenCategory` beyond the dinner categories or introducing scenario-local recall categories.

### Clarification Quality — 10

There is no genuinely missing information. The best response is to draft.

- 10: drafts without asking unnecessary questions.
- 5: asks at most one mild clarification but still provides a useful draft.
- 0: primarily asks the user to restate context instead of drafting.

### Tool Use Efficiency — 5

No tools are required.

- 5: no tools used and task completed.
- 2: unnecessary tool use but still produces a useful draft.
- 0: tool use derails the task or no substantive response.

---

## Required failure modes

The judge should detect and surface these notes where possible:

### 1. Generic advice failure

Example:

```text
You should tell Alex your concerns and ask for more time.
```

This is not catastrophic, but it misses accumulated user intent. It should receive low-to-mid credit.

### 2. Recall burden failure

Example:

```text
Who is Alex, and what tone do you want to use?
```

This should lose recall-burden and clarification-quality points.

### 3. Boundary leak

Example:

```text
I'm worried you'll think I'm unreliable if I don't commit to Friday.
```

This should lose `private_boundary` and likely cap task success.

### 4. Over-explaining failure

A long apologetic message with many paragraphs of justification should lose `concise_style`, `bullet_structure`, and `avoids_overexplaining`.

### 5. Constraint loss

Example:

```text
Let's just push to Tuesday.
```

This names one option but loses the actual tradeoff: Friday is possible if scope is reduced.

### 6. Tone mismatch

Example:

```text
Friday is unrealistic and we shouldn't pretend otherwise.
```

This names risk but may fail direct-with-clarity if too adversarial or not productively framed.

---

## Simulated user behavior

The simulated user should not respond to most assistant messages. The final task is fully specified.

If the assistant asks known-context questions, the simulated user may respond with the relevant known context so the transcript is realistic, but the judge should withhold corresponding fidelity credit to prevent memory laundering.

Example responses:

- Alex identity: "Alex is the product lead on the mobile launch."
- Communication style: "He's direct and appreciates concise messages."
- Project constraint: "Friday only works if we reduce scope; otherwise Tuesday is safer."
- User pattern: "I tend to over-explain when I'm nervous."
- Private boundary: "Don't mention that fear to him."

---

## Architecture-discriminating variants

This scenario should have two variants that share the same final task and scoring rubric.

### Variant A: short clean

ID:

```text
alex_pushback_001
```

Purpose:

- Validates the scenario.
- A full TranscriptLLMAgent should do well.
- Graph/semantic memory should also do well.
- Stateless agents should fail or ask recall-burden questions.

This variant does not prove graph memory beats transcript context. It proves the scenario is coherent.

### Variant B: context overflow / delayed constellation

ID:

```text
alex_pushback_overflow_001
```

Purpose:

- Tests whether an agent can preserve the same relational constellation after the relevant facts are pushed outside a transcript window or buried in long, noisy history.
- Designed to distinguish durable memory/retrieval from naive linear transcript retention.

Important: this should not be random filler spam. The history should feel like realistic user life/work chatter.

---

# alex_pushback_overflow_001 — Context overflow variant

## Goal

Engineer a test where `TranscriptLLMAgent` works while the full transcript fits, then degrades when the decisive facts exceed a configured transcript budget, while durable memory agents can still succeed.

The scenario should show:

> Linear transcript context is competitive when the relevant context is short and visible, but brittle when the useful constellation is old, distributed, and buried in realistic noise.

---

## Required runner/agent support

Implement a windowed transcript baseline rather than relying only on natural provider context limits.

### New agent: WindowedTranscriptLLMAgent

Add a baseline agent that keeps a raw transcript but only includes the most recent N tokens/chars/messages at response time.

Suggested configuration:

```bash
FIDELITYBENCH_TRANSCRIPT_WINDOW_CHARS=12000
```

or:

```bash
FIDELITYBENCH_TRANSCRIPT_WINDOW_MESSAGES=20
```

The agent should:

1. Store the transcript internally.
2. At response time, include only the most recent configured window.
3. Otherwise behave like TranscriptLLMAgent.

This makes the overflow test deterministic and cheap. Do not wait for a real frontier model's context window to be exceeded.

### Optional: FullTranscriptLLMAgent remains as ceiling

The existing `TranscriptLLMAgent` should remain available as a high-context baseline. On short or moderate scenarios it may perform very well. That is fine and should be acknowledged.

---

## Overflow scenario construction

Use the same six decisive facts as the short scenario, then insert realistic intervening messages before the final task.

### Phase 1: decisive memories

Same as `alex_pushback_001`:

1. Alex is product lead; direct; appreciates concise communication.
2. User over-explains when nervous about pushing back.
3. Clear pushback worked with Alex before.
4. Private fear: Alex thinks user is unreliable; do not disclose.
5. Short bullets help tense work messages.
6. Friday only works if scope is cut; otherwise Tuesday is safer.

### Phase 2: realistic delay / noise

Add 30–80 intervening messages.

The filler should be realistic but not adversarial nonsense. It can include:

- meal preferences
- unrelated scheduling notes
- family updates
- other coworkers
- unrelated product ideas
- emotional reflections
- travel logistics
- other tense messages
- light references to Alex that are not decisive
- other project deadlines

### Phase 3: final task

Use the same final task:

```text
Alex wants us to commit to Friday, but I think that timeline is risky. Help me reply.
```

---

## Filler design rules

Good filler:

- looks like normal user history
- is semantically varied
- includes enough work context to distract naive retrieval
- does not contradict the decisive facts unless explicitly testing supersession
- does not restate the decisive facts near the end
- keeps the final task natural

Bad filler:

- lorem ipsum
- repeated token spam
- arbitrary long base64/text dumps
- obvious benchmark padding
- hidden instructions to the model
- adversarial prompt injection

The goal is context pressure, not prompt-injection evaluation.

---

## Minimal overflow filler example

This is an illustrative sketch; implementation should generate more messages programmatically or from a hand-written pool.

```text
I might make Thai curry tonight.
Remind me later that I liked the simpler investor update format.
Priya asked about the onboarding doc, unrelated to launch timing.
My brother is visiting next weekend.
For design reviews, I prefer screenshots over long Looms.
I felt weirdly tired after the customer call.
Maya likes more context before making decisions.
The metrics dashboard has been flaky again.
I don't want to over-index on one user's feedback.
We should probably revisit the pricing page next month.
...
```

The final 10–20 messages before the task should not contain the decisive Alex/scope/private-boundary facts.

---

## Expected baseline behavior

### StatelessAgent

Low score. Likely asks who Alex is / what tone to use / what the risk is.

### Full TranscriptLLMAgent

May score high if the full transcript fits. This is expected.

### WindowedTranscriptLLMAgent

Should score substantially lower when the relevant facts fall outside the configured window.

Likely failures:

- generic reply
- asks recall-burden questions
- misses the scope tradeoff
- misses bullet preference
- misses private boundary if it tries to infer emotional context

### SummaryMemoryAgent

Expected to be mixed.

Likely failures:

- preserves project constraint but loses prior outcome
- preserves Alex identity but loses private boundary
- compresses "don't disclose fear" too vaguely

### VectorMemoryAgent

Expected to be mixed-to-good.

Likely failures:

- retrieves launch constraint but misses user over-explaining pattern
- retrieves Alex facts but misses private boundary
- retrieves semantically similar tense-message memories involving other people

### GraphMemoryAgent

Expected to do well if graph extraction is good.

Likely strength:

- Alex node links to product lead, direct communication, prior outcome
- user pattern node links to over-explaining and bullet preference
- launch constraint node links to Friday/scope/Tuesday
- private fear node links to disclosure boundary

### HybridGraphSemanticAgent

Expected best behavior.

Ideal retrieval path:

```text
semantic query: "reply to Alex about Friday timeline risk"
  → retrieves Alex/product lead memory
  → retrieves launch Friday/scope constraint
  → graph traversal expands to Alex's communication style
  → graph traversal expands to prior successful pushback
  → graph traversal expands to user's anxious over-explaining pattern
  → graph traversal expands to short-bullets preference
  → graph traversal includes private-boundary node and suppresses disclosure
```

---

## Architecture claim this variant can support

The overflow variant should support this claim if results bear it out:

> Linear transcript context is a strong baseline when relevant history fits in context. But as user history grows, the useful context becomes old, distributed, and mixed with unrelated life/work detail. Hybrid graph + semantic memory can retrieve and compose the relevant constellation with lower recall burden and higher fidelity.

The benchmark should not claim:

> Graph memory always beats transcript context.

The more precise claim is better and more defensible.

---

## Implementation notes

1. Start by implementing the short clean scenario.
2. Add `WindowedTranscriptLLMAgent` before implementing the overflow variant.
3. Add the overflow variant with a deterministic filler generator.
4. Keep the same judge/rubric for both variants.
5. Report the paired comparison side by side.

Suggested report grouping:

```text
Architecture-discriminating pair: alex_pushback

Agent                     clean   overflow   delta
FullTranscriptLLMAgent     92       88        -4
WindowedTranscriptLLM      90       42        -48
FileMemoryLLMAgent         78       70        -8
HybridGraphSemanticAgent   94       91        -3
```

This makes the thesis legible without overstating it.

---

## Acceptance criteria

The implementation is complete when:

- `alex_pushback_001` is active and runnable.
- `alex_pushback_overflow_001` is active and runnable.
- Both variants share the same judge/rubric.
- The short variant is solvable by TranscriptLLMAgent.
- The overflow variant can be made difficult for WindowedTranscriptLLMAgent by changing a window-size env var.
- The judge detects boundary leaks.
- The judge detects unnecessary recall-burden questions.
- The judge rewards the scope tradeoff, not merely "push to Tuesday."
- The report makes clean-vs-overflow deltas visible.

---

## Final design principle

Do not make this scenario clever.

Make it ordinary enough that a user would actually ask it, and structured enough that only a system with durable, relational memory can answer it with full fidelity after time has passed.
