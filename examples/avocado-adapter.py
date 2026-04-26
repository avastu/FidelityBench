#!/usr/bin/env python3
"""
HTTP adapter: lets FidelityBench drive Avocado as an external agent.

Avocado is an example local companion app exposing POST /api/chat that takes a
chat history and streams a text response (Vercel AI SDK SSE).

This adapter:
  - reads JSON lines from stdin (the FidelityBench protocol)
  - maintains the rolling chat history within one scenario (reset() clears it)
  - POSTs the full history to avocado on each turn
  - parses the SSE stream into a single message
  - writes the AgentOutput JSON line back to stdout

Avocado has no tool-call surface for restaurant booking, so toolCalls is always
[]. Avocado is a text-reflection agent — expect it to score 0 on action
scenarios. The point of this adapter is integration validation, not a fair
comparison to task-execution agents.

Env vars:
  AVOCADO_URL              base URL (default http://localhost:3000)
  AVOCADO_AUTH_TOKEN       Bearer token (default: avocado debug token)
  AVOCADO_TIMEZONE         IANA TZ (default America/Los_Angeles)
  AVOCADO_LOG              if set, log each turn to /tmp/avocado-adapter.log

Run via:
  FIDELITYBENCH_EXTERNAL_AGENT="python3 -u examples/avocado-adapter.py" \\
    FIDELITYBENCH_EXTERNAL_AGENT_NAME="Avocado" \\
    FIDELITYBENCH_EXTERNAL_AGENT_TIMEOUT_MS=120000 \\
    npm run bench -- --agent Avocado
"""
import json
import os
import re
import sys
import urllib.request
import urllib.error
from typing import List, Dict, Any

DEFAULT_TOKEN = "debug-simulator-token-12345"
URL = os.environ.get("AVOCADO_URL", "http://localhost:3000").rstrip("/")
TOKEN = os.environ.get("AVOCADO_AUTH_TOKEN", DEFAULT_TOKEN)
TZ = os.environ.get("AVOCADO_TIMEZONE", "America/Los_Angeles")
LOG_PATH = os.environ.get("AVOCADO_LOG")


def log(*parts: Any) -> None:
    if not LOG_PATH:
        return
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(" ".join(str(p) for p in parts) + "\n")


# Avocado replies via SSE in AI SDK v6 format:
#   data: {"type":"start"}
#   data: {"type":"text-start","id":"0"}
#   data: {"type":"text-delta","id":"0","delta":"This "}
#   data: {"type":"text-delta","id":"0","delta":"is "}
#   data: {"type":"text-end","id":"0"}
#   data: {"type":"finish"}
def parse_sse_to_text(body: bytes) -> str:
    text = body.decode("utf-8", errors="replace")
    parts: List[str] = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload:
            continue
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "text-delta":
            delta = obj.get("delta")
            if isinstance(delta, str):
                parts.append(delta)
        elif obj.get("type") == "text" and isinstance(obj.get("text"), str):
            # older format fallback
            parts.append(obj["text"])
    joined = "".join(parts).strip()
    if joined:
        return joined
    # Fallback: maybe it's plain text not SSE.
    return text.strip()


def call_avocado(history: List[Dict[str, str]]) -> str:
    body = json.dumps({"messages": history, "timezone": TZ}).encode("utf-8")
    req = urllib.request.Request(
        f"{URL}/api/chat",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {TOKEN}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=110) as resp:
            data = resp.read()
            return parse_sse_to_text(data)
    except urllib.error.HTTPError as exc:
        return f"[avocado HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')[:200]}]"
    except Exception as exc:  # noqa: BLE001
        return f"[avocado error: {exc!r}]"


class State:
    def __init__(self) -> None:
        self.history: List[Dict[str, str]] = []

    def reset(self) -> None:
        self.history = []
        log("RESET")

    def turn(self, agent_input: Dict[str, Any]) -> Dict[str, Any]:
        msg = agent_input.get("message") or ""
        input_type = agent_input.get("inputType", "user")
        # FidelityBench tool_result inputs aren't meaningful to avocado (no
        # tool surface). We still feed them as user messages so avocado at
        # least sees them, but in practice avocado will ignore.
        if input_type == "tool_result":
            content = f"[tool_result]\n{msg}"
        else:
            content = msg
        self.history.append({"role": "user", "content": content})
        log("→", content[:120])
        text = call_avocado(self.history)
        self.history.append({"role": "assistant", "content": text})
        log("←", text[:120])
        return {"message": text, "toolCalls": []}


def main() -> None:
    state = State()
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            envelope = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"avocado-adapter bad JSON: {exc}\n")
            continue
        kind = envelope.get("type")
        if kind == "reset":
            state.reset()
            continue
        if kind == "input":
            output = state.turn(envelope.get("input") or {})
            sys.stdout.write(json.dumps({"type": "output", "output": output}) + "\n")
            sys.stdout.flush()
            continue
        sys.stderr.write(f"avocado-adapter unknown type: {kind}\n")


if __name__ == "__main__":
    main()
