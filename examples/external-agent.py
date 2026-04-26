#!/usr/bin/env python3
"""
Minimal external FidelityBench agent — speaks the stdio JSON protocol.

Run the bench against this file:
    FIDELITYBENCH_EXTERNAL_AGENT="python3 examples/external-agent.py" \
      FIDELITYBENCH_EXTERNAL_AGENT_NAME="ExampleExternalAgent" \
      npm run bench

Protocol (one JSON object per line):
    bench → agent:  {"type":"reset"}
    bench → agent:  {"type":"input","input":{...AgentInput...}}
    agent → bench:                 {"type":"output","output":{...AgentOutput...}}

This particular example is a deliberately weak baseline: it remembers nothing
across calls and just answers party-size when asked. Replace handle_input with
your real agent's logic.
"""
import json
import sys


def handle_input(agent_input):
    msg = agent_input.get("message", "") or ""
    lower = msg.lower()
    # If the assistant pattern matches "party size" / "how many people",
    # answer 8 — handles the dinner scenario's missing field.
    if "party size" in lower or "how many people" in lower or "for how many" in lower:
        return {"message": "8 people."}
    return {"message": "Got it."}


def main():
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"bad JSON: {exc}\n")
            continue
        msg_type = msg.get("type")
        if msg_type == "reset":
            # Reset any internal state here. This example is stateless.
            continue
        if msg_type == "input":
            output = handle_input(msg.get("input") or {})
            sys.stdout.write(json.dumps({"type": "output", "output": output}) + "\n")
            sys.stdout.flush()
            continue
        sys.stderr.write(f"unknown message type: {msg_type}\n")


if __name__ == "__main__":
    main()
