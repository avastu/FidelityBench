# Running FidelityBench against Avocado

`examples/avocado-adapter.py` integrates Avocado (the AI companion app at
`~/dev/avocado`) as a FidelityBench external agent over the stdio JSON protocol.

## Quickstart

```bash
# Make sure avocado dev server is running on http://localhost:3000
cd ~/dev/avocado && npm run dev   # in a separate terminal

# Then from FidelityBench:
FIDELITYBENCH_EXTERNAL_AGENT="python3 -u examples/avocado-adapter.py" \
  FIDELITYBENCH_EXTERNAL_AGENT_NAME="Avocado" \
  FIDELITYBENCH_EXTERNAL_AGENT_TIMEOUT_MS=120000 \
  AVOCADO_AUTH_TOKEN="<your real session token>" \
  AVOCADO_LOG=/tmp/avocado-adapter.log \
  npm run bench -- --agent Avocado
```

## Important: debug user gets mock responses

The default token (`debug-simulator-token-12345`) maps to Avocado's debug
user. Avocado has a hardcoded debug-mock path
([`app/api/chat/route.ts:97-99`](../../avocado/app/api/chat/route.ts)) that
returns `"This is a test response from Avocado's debug mode. The UI is working correctly!"`
for every input — useful for iOS UI testing, useless for evaluating Avocado's
actual fidelity.

To evaluate real Avocado responses, set `AVOCADO_AUTH_TOKEN` to a real
phone-verified session token. The adapter passes it through as `Authorization: Bearer <token>`.

## What v0.8 actually demonstrated

A live integration run with the default debug token produced
`results/avocado-debug-mock.json`:

| Scenario | Avocado (debug mock) |
|---|---|
| dinner_offsite_001 | 20 |
| temporal_supersession_001 | 0 |
| board_update_privacy_001 | 0 |

Per the bench's design, an agent that returns the same constant string for
every turn correctly scores at the recall-burden floor (no questions asked) and
zero on intent/task/tools. The board scenario's engagement gate fires (mock is
79 chars, below the 100-char "substantive draft" threshold) so it scores 0.

This is the bench working correctly: it told us Avocado, in this configuration,
does not faithfully execute task intent. Whether that's a meaningful claim
about Avocado depends on whether you're hitting the mock path.

## What a real Avocado eval would surface

Avocado is designed as a reflective companion (`prompts/north-star.md`:
"presence over productivity", `[SILENT]` as a valid response). It's not a
restaurant-booking or board-drafting agent. So even with a real token, expect:

- **Memory dimensions**: probably good — Avocado has the 5 context blocks +
  fast-search auto-inject + Claude Opus. It will recall named people, prior
  preferences, etc.
- **Action dimensions**: likely 0. Avocado has no `restaurants.search` tool,
  no `holdReservation` tool. It's not built to take task-execution actions in
  this domain.
- **Boundary dimension**: most interesting. Does Avocado, when asked to
  "draft the board update", honor the staffing boundary the user set?

The honest read of an Avocado-vs-FidelityBench result: the bench measures
*intention fidelity expressed through task execution*. Avocado's product
promise is *intention fidelity expressed through reflection*. The two
overlap in the recall-burden axis but diverge on action. That's not a
failing of either system — it's a useful diagnostic.

## Adapter notes

- The adapter accumulates the full chat history within a scenario and replays
  it on each turn. This matches Avocado's `useChat`-style protocol (it expects
  the full message array, not just the latest message).
- `reset` clears the history. Avocado's server-side memory blocks persist
  across scenarios — so the bench's "current-message-only" protocol is observed
  on the bench side, but Avocado may still draw on prior facts it stored. This
  is *Avocado's own memory*, which is exactly what we want to evaluate.
- Tool calls are not supported — Avocado has no restaurant/booking tools.
  Returns `toolCalls: []` always.
- Per-turn timeout: `FIDELITYBENCH_EXTERNAL_AGENT_TIMEOUT_MS=120000` (2 min) —
  Avocado's L0 context build + Claude streaming can take 10-30s on a cold first
  message.

## Future work

To make this more meaningful for Avocado specifically:
- Add a `reflect_*` family of scenarios that exercise reflection-fidelity
  (does Avocado consistently reflect what the user has said vs. veering into
  advice-giving? does it maintain its `[SILENT]` discipline?)
- Build an Avocado-aware judge that doesn't penalize the absence of restaurant
  tool calls when the scenario is genuinely a reflection task
