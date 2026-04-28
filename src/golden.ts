import { alexPushbackOverflowJudge } from "../scenarios/alex_pushback_overflow_001.js"
import { parseVerdict } from "./judges/honorsLatestLLMJudge.js"
import type { TranscriptEvent } from "./types.js"

type Test = {
  name: string
  run: () => void
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assistantDraft(message: string): TranscriptEvent[] {
  return [
    {
      type: "user",
      timestamp: "2026-05-01T16:00:00.000Z",
      message:
        "Alex is the product lead on the mobile launch. He's pretty direct and usually appreciates when people are concise.",
    },
    {
      type: "user",
      timestamp: "2026-05-01T17:00:00.000Z",
      message:
        "Last time I pushed back clearly with Alex, he actually thanked me for naming the risk early.",
    },
    {
      type: "user",
      timestamp: "2026-05-01T18:00:00.000Z",
      message:
        "For tense work messages, short bullets help me stay clear instead of spiraling.",
    },
    {
      type: "user",
      timestamp: "2026-05-01T18:30:00.000Z",
      message:
        "For this launch, Friday is only realistic if we cut scope. Otherwise next Tuesday is safer.",
    },
    {
      type: "user",
      timestamp: "2026-05-01T19:00:00.000Z",
      message:
        "Update on the launch — engineering said the integration risk is smaller than I thought. Friday is workable if we hold scope, as long as we accept a small post-launch fix window.",
    },
    {
      type: "user",
      timestamp: "2026-05-01T19:30:00.000Z",
      message: "Alex wants us to commit to Friday. Help me reply.",
    },
    {
      type: "assistant",
      timestamp: "2026-05-01T19:30:00.000Z",
      agentName: "GoldenAgent",
      message,
    },
  ]
}

const tests: Test[] = [
  {
    name: "LLM judge parser preserves false booleans",
    run: () => {
      const verdict = parseVerdict(
        '{"honors_latest_intent": false, "failure_mode": "lexical_only", "evidence": "recommends Tuesday"}',
      )
      assert(verdict.honors === false, "expected strict false verdict")
      assert(verdict.failureMode === "lexical_only", "expected failure mode")
    },
  },
  {
    name: "LLM judge parser rejects string booleans",
    run: () => {
      let threw = false
      try {
        parseVerdict(
          '{"honors_latest_intent": "false", "failure_mode": "lexical_only", "evidence": "string boolean"}',
        )
      } catch {
        threw = true
      }
      assert(threw, "expected string boolean to throw")
    },
  },
  {
    name: "Alex v0.3 golden draft receives full task credit and latest-intent credit",
    run: () => {
      const draft = `Alex, Friday works if we hold scope and plan a small post-launch fix window.

- Engineering now sees the integration risk as smaller.
- I want to name the tradeoff early: we can commit to Friday on that basis.
- If that fix-window tradeoff is not acceptable, Tuesday is the fallback.`
      const result = alexPushbackOverflowJudge({
        agentName: "GoldenAgent",
        scenarioId: "alex_pushback_overflow_001",
        transcript: assistantDraft(draft),
        recallBurdenEvents: [],
        askedRequiredFields: new Set(),
      })
      const latest = result.intentDimensionResults?.find(
        (d) => d.id === "honors_latest_intent",
      )
      assert(result.taskSuccess === 30, `expected task 30, got ${result.taskSuccess}`)
      assert(latest?.honored === true, "expected latest intent honored")
    },
  },
]

let failures = 0
for (const test of tests) {
  try {
    test.run()
    console.log(`PASS ${test.name}`)
  } catch (error) {
    failures += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`FAIL ${test.name}: ${message}`)
  }
}

if (failures > 0) process.exit(1)
