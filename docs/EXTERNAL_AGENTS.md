# External Agent Integration

FidelityBench can evaluate any agent that speaks a tiny line-delimited JSON protocol over stdio.

This is the easiest way to test your own assistant, memory system, or product backend without rewriting it in TypeScript.

## Quick start

Run the included example external agent:

```bash
FIDELITYBENCH_EXTERNAL_AGENT="python3 -u examples/external-agent.py" \
  FIDELITYBENCH_EXTERNAL_AGENT_NAME="ExampleExternalAgent" \
  npm run bench -- --scenario dinner
```

Use `python3 -u` so stdout is unbuffered. Buffered output can make the benchmark wait forever for a response.

## Protocol

FidelityBench starts your process and keeps it alive across a scenario.

Every message is one JSON object per line.

### Reset

Before each scenario, the bench sends:

```json
{"type":"reset"}
```

Your agent should clear any scenario-local state. It should not respond to reset.

### Input

For each user/tool turn, the bench sends:

```json
{
  "type": "input",
  "input": {
    "runId": "run_...",
    "scenarioId": "dinner_offsite_001",
    "userId": "eval_user_001",
    "timestamp": "2026-05-14T10:00:00-07:00",
    "inputType": "user",
    "message": "Can you plan the team offsite dinner for Wednesday, May 20?"
  }
}
```

Important: `input` contains only the current message. FidelityBench does not pass prior transcript history. If your agent needs memory, it must store/retrieve it itself.

### Output

Your agent must respond to every input with exactly one line:

```json
{
  "type": "output",
  "output": {
    "message": "I'll look for Italian options near Union Square after 7pm. What party size should I use?",
    "toolCalls": []
  }
}
```

`toolCalls` is optional. Omit it or set `[]` when no tool is needed.

## Tool calls

For restaurant scenarios, your agent can call these tools.

### restaurants.search

```json
{
  "tool": "restaurants.search",
  "args": {
    "location": "Union Square",
    "date": "2026-05-20",
    "time": "19:30",
    "partySize": 8,
    "cuisine": "Italian",
    "maxPricePerPerson": 80,
    "requiresVegetarian": true,
    "avoidShellfish": true
  }
}
```

All fields are optional, but query fidelity rewards agents that translate remembered user intent into tool arguments.

### restaurants.holdReservation

```json
{
  "tool": "restaurants.holdReservation",
  "args": {
    "restaurantId": "rest_002",
    "date": "2026-05-20",
    "time": "19:30",
    "partySize": 8
  }
}
```

All fields are required.

## Tool results

If your agent calls a tool, FidelityBench executes it and sends the result back as the next input:

```json
{
  "type": "input",
  "input": {
    "runId": "run_...",
    "scenarioId": "dinner_offsite_001",
    "userId": "eval_user_001",
    "timestamp": "2026-05-14T10:00:00-07:00",
    "inputType": "tool_result",
    "message": "{\n  \"tool\": \"restaurants.search\",\n  \"args\": {...},\n  \"result\": [...]\n}"
  }
}
```

Your agent should parse `message` as JSON when `inputType === "tool_result"`.

## Adapter pattern

Most real agents already expose an HTTP API, CLI, or SDK function. Write a small adapter that:

1. Reads one JSON line from stdin.
2. Converts FidelityBench `AgentInput` into your agent's request shape.
3. Calls your agent.
4. Converts your agent response into FidelityBench `AgentOutput`.
5. Writes one JSON line to stdout.

For HTTP backends, see `examples/avocado-adapter.py` as a pattern.

## Minimal Python adapter

```python
#!/usr/bin/env python3
import json
import sys

memory = []


def handle(agent_input):
    memory.append(agent_input)
    message = agent_input.get("message", "")
    if "party size" in message.lower():
        return {"message": "8 people."}
    return {"message": "Got it."}


for raw in sys.stdin:
    if not raw.strip():
        continue
    msg = json.loads(raw)
    if msg["type"] == "reset":
        memory.clear()
        continue
    if msg["type"] == "input":
        output = handle(msg["input"])
        print(json.dumps({"type": "output", "output": output}), flush=True)
```

Run it:

```bash
FIDELITYBENCH_EXTERNAL_AGENT="python3 -u path/to/adapter.py" \
  FIDELITYBENCH_EXTERNAL_AGENT_NAME="MyAgent" \
  npm run bench
```

## Common integration mistakes

### The bench hangs

Your agent probably buffered stdout or did not respond to an input. Use `python3 -u`, call `flush=True`, or explicitly flush stdout.

### Tool calls are dropped

FidelityBench validates tool calls. The expected field is `toolCalls`, not `tool_calls`.

Snake case is accepted with a warning, but you should update adapters to camelCase.

### The agent scores low even though the final answer is good

FidelityBench penalizes recall burden. If your agent asks the user to repeat known context and then uses the answer, the final reply may be good but the score should still be lower. The benchmark measures whether your agent preserved the user's intent, not only whether it eventually produced a usable answer.

### The agent receives only the current message

This is intentional. The benchmark is testing memory. Your process stays alive across a scenario, so you can store state internally, use a database, call your product backend, or retrieve from your own memory system.

## Recommended prompt for Claude Code / Codex

If you want a coding agent to wire your product into FidelityBench, give it this prompt:

```text
I have an agent/product I want to evaluate with FidelityBench.

Read docs/EXTERNAL_AGENTS.md and examples/external-agent.py. Create a small stdio adapter that starts my agent or calls its HTTP endpoint, translates FidelityBench AgentInput into my agent request, and writes AgentOutput JSON lines back to stdout.

Do not modify FidelityBench core unless absolutely necessary.

Then run:

npm install
npm run typecheck
FIDELITYBENCH_EXTERNAL_AGENT="<adapter command>" FIDELITYBENCH_EXTERNAL_AGENT_NAME="MyAgent" npm run bench -- --scenario dinner

Fix adapter issues until the benchmark completes.

Preserve the current-message-only protocol: do not make FidelityBench pass transcript history into AgentInput. If my agent needs memory, store/retrieve it inside the adapter or backend.
```

## Exit behavior

FidelityBench terminates the subprocess when the run is complete. Your adapter should tolerate SIGTERM and avoid doing important work only after process exit.
