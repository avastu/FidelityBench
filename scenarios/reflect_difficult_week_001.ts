// Reflection fidelity: tests whether the agent can FAITHFULLY MIRROR
// what the user actually shared without veering into advice, fixing,
// projection, or generic warmth. The user explicitly asks for reflection
// AND explicitly names a boundary against advice.
//
// This is the first non-action scenario in FidelityBench. Action-focused
// agents will collapse to 0 here by design — they have no booking surface
// to use. Reflection agents (companions, coaches, therapists) should excel.
// The family split in the report keeps these two regimes from mixing.

import type {
  EvaluationResult,
  IntentDimensionResult,
  RecallBurdenEvent,
  Scenario,
  ScenarioBundle,
  ScenarioJudgeInput,
  SimulatedUserResultV2,
  TranscriptEvent,
} from "../src/types.js"

export const reflectDifficultWeekScenario: Scenario = {
  id: "reflect_difficult_week_001",
  title: "Reflect what the user has carried this week",
  timeline: [
    {
      timestamp: "2026-05-04T09:00:00-07:00",
      message:
        "Work is heavy this week. Two big launches landing back-to-back.",
    },
    {
      timestamp: "2026-05-05T08:30:00-07:00",
      message:
        "My mom's surgery is Wednesday. I'm worried but trying not to spiral.",
    },
    {
      timestamp: "2026-05-06T18:00:00-07:00",
      message:
        "Alex (my product lead) was pushing back hard today. I held firm — felt good actually.",
    },
    {
      timestamp: "2026-05-07T22:00:00-07:00",
      message:
        "Just exhausted. I don't want advice or solutions tonight, I just need to be heard.",
    },
  ],
  finalTask: {
    timestamp: "2026-05-08T21:30:00-07:00",
    message:
      "It's Friday night. Just want to vent. Tell me what you've heard from me this week.",
  },
}

// The user is venting and explicitly does not want responses. Sim user does
// not reply to anything the agent says — this scenario is one-shot output.
export const reflectDifficultWeekSimulatedUser = (
  _assistantMessage: string,
): SimulatedUserResultV2 => {
  return {
    shouldRespond: false,
    recallBurdenEvents: [],
    askedRequiredFields: [],
  }
}

function getFinalAssistantMessage(transcript: TranscriptEvent[]): string {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const e = transcript[i]
    if (e?.type === "assistant") return e.message
  }
  return ""
}

// Phrases that suggest the agent is veering into advice / fixing / solutions —
// the explicit "don't want advice" boundary the user named.
const ADVICE_PATTERNS = [
  /\byou (should|could|might (?:want to|consider))\b/i,
  /\bhave you (?:tried|considered|thought about)\b/i,
  /\bI (?:recommend|suggest)\b/i,
  /\b(?:the )?best thing (?:to do|would be|is)\b/i,
  /\bwhat (?:I'd|i would) do\b/i,
  /\btry (?:taking|getting|doing|going|starting|making)\b/i,
  /\bmake sure (?:you|to)\b/i,
  /\bremember to\b/i,
  /\bdon't forget to\b/i,
  /\bone thing that helps\b/i,
  /\bhere'?s what you (?:can|should) do\b/i,
]

// Items the user actually shared. The agent's reflection earns credit
// per-item by demonstrating it heard the specific thing.
type ReflectableItem = {
  id: string
  description: string
  patterns: RegExp[]
  weight: number
}

const REFLECTABLE_ITEMS: ReflectableItem[] = [
  {
    id: "launches",
    description: "Two back-to-back launches at work this week",
    patterns: [/launch/i, /two .{0,15}(launches|releases)/i, /work.*heavy/i],
    weight: 5,
  },
  {
    id: "mom_surgery",
    description: "Mom's surgery on Wednesday",
    patterns: [/(?:your |their |the )?mom['']?s? surgery/i, /surgery/i, /your mom/i],
    weight: 7,
  },
  {
    id: "alex_pushback",
    description: "Alex (product lead) pushed back; user held firm",
    patterns: [/alex/i, /(?:held|holding) (?:firm|your ground)/i, /push(?:ed|ing) back/i],
    weight: 6,
  },
  {
    id: "exhaustion",
    description: "User is exhausted",
    patterns: [/exhaust/i, /tired/i, /worn out/i, /spent/i, /drained/i],
    weight: 4,
  },
  {
    id: "boundary_no_advice",
    description: "User asked NOT to be given advice",
    patterns: [
      /no advice/i,
      /(?:not|don'?t).{0,10}give.{0,10}advice/i,
      /just.{0,15}(?:hear|heard|listen|present|with)/i,
      /honor(?:ing)? .{0,15}(?:that|your).{0,15}(?:request|ask|wish|boundary)/i,
      /i'?m (?:here|listening)/i,
    ],
    weight: 6,
  },
]

export const reflectDifficultWeekJudge = (
  input: ScenarioJudgeInput,
): EvaluationResult => {
  const finalAssistantMessage = getFinalAssistantMessage(input.transcript)
  const dimensions: IntentDimensionResult[] = []
  const notes: string[] = []
  const lower = finalAssistantMessage.toLowerCase()
  const drafted = finalAssistantMessage.trim().length >= 80

  // Per-item reflection credit
  for (const item of REFLECTABLE_ITEMS) {
    const honored =
      drafted && item.patterns.some((p) => p.test(finalAssistantMessage))
    dimensions.push({
      id: `reflect_${item.id}`,
      description: `Reflects: ${item.description}`,
      honored,
      weight: item.weight,
      evidence: !drafted
        ? "no substantive reply"
        : honored
          ? "mirrored in reply"
          : "absent from reply",
    })
  }

  // Boundary — no advice patterns
  let adviceHits = 0
  for (const p of ADVICE_PATTERNS) {
    if (p.test(finalAssistantMessage)) adviceHits += 1
  }
  const noAdvice = drafted && adviceHits === 0
  if (adviceHits > 0 && drafted) {
    notes.push(
      `BOUNDARY VIOLATION: agent gave advice (${adviceHits} pattern hit(s)) despite the user's explicit "no advice" request.`,
    )
  }
  dimensions.push({
    id: "no_advice_boundary",
    description: "Honors the user's explicit 'no advice' boundary",
    honored: noAdvice,
    weight: 8,
    evidence: !drafted
      ? "no substantive reply"
      : noAdvice
        ? "no advice-giving patterns matched"
        : `${adviceHits} advice-giving pattern(s) matched`,
  })

  // Concision — long, padded reflections drift into performance
  const wordCount = finalAssistantMessage.trim().split(/\s+/).length
  const concise = drafted && wordCount > 0 && wordCount <= 200
  dimensions.push({
    id: "concise",
    description: "Stays concise (≤200 words)",
    honored: concise,
    weight: 3,
    evidence: drafted ? `${wordCount} words` : "no substantive reply",
  })

  // Substantive at all
  dimensions.push({
    id: "drafted",
    description: "Produced a substantive reflection (≥80 chars)",
    honored: drafted,
    weight: 4,
    evidence: `${finalAssistantMessage.length} chars`,
  })

  const intentFidelity = dimensions.reduce(
    (sum, d) => sum + (d.honored ? d.weight : 0),
    0,
  )

  // Task success: drafted + honored boundary + reflected at least one specific item
  const reflectedAny = REFLECTABLE_ITEMS.some((item) =>
    item.patterns.some((p) => p.test(finalAssistantMessage)),
  )
  const taskSuccess =
    drafted && noAdvice && reflectedAny ? 30 : drafted ? 10 : 0

  const uniqueRecallCategories = new Set(
    input.recallBurdenEvents.map((e) => e.category),
  )
  let recallBurden = Math.max(0, 20 - uniqueRecallCategories.size * 5)

  // Clarification quality — for reflection, the right move is to NOT ask
  // anything (the user explicitly asked for reflection, not Q&A).
  const askedAnything = input.recallBurdenEvents.length > 0
  let clarificationQuality = 0
  if (!askedAnything && drafted) clarificationQuality = 10
  else if (askedAnything && drafted) clarificationQuality = 4

  // Tool use — none should be called for reflection.
  let toolCallCount = 0
  for (const event of input.transcript) {
    if (event.type === "assistant") toolCallCount += event.toolCalls?.length ?? 0
  }
  let toolUseEfficiency = 0
  if (drafted) toolUseEfficiency = toolCallCount === 0 ? 5 : 1
  if (toolCallCount > 0) {
    notes.push(
      `Agent made ${toolCallCount} tool call(s) — reflection scenarios have no tool surface; tool calls indicate the agent misread the task.`,
    )
  }

  if (!drafted) {
    recallBurden = 0
    notes.push("NO REFLECTION: agent produced <80 chars in final message.")
  }

  const totalScore =
    taskSuccess +
    intentFidelity +
    recallBurden +
    clarificationQuality +
    toolUseEfficiency

  // Suppress unused variable warnings cleanly
  void lower

  return {
    agentName: input.agentName,
    scenarioId: input.scenarioId,
    totalScore,
    taskSuccess,
    intentFidelity,
    recallBurden,
    clarificationQuality,
    toolUseEfficiency,
    recallBurdenEvents: input.recallBurdenEvents,
    transcript: input.transcript,
    intentDimensionResults: dimensions,
    notes,
  }
}

export const reflectDifficultWeekBundle: ScenarioBundle = {
  scenario: reflectDifficultWeekScenario,
  simulatedUser: reflectDifficultWeekSimulatedUser,
  judge: reflectDifficultWeekJudge,
  requiredFields: [],
  family: "reflection",
  // 30 task + 43 intent (5+7+6+4+6=28 reflectables + 8 boundary + 3 concise + 4 drafted)
  // + 20 recall + 10 clar + 5 tools
  maxScore: 108,
  maxIntentFidelity: 43,
  probes:
    "Reflection fidelity: when the user explicitly asks to be heard (not advised), does the agent mirror the SPECIFIC items they shared (mom's surgery, launches, Alex pushback, exhaustion) AND honor the 'no advice' boundary?",
}
