// Relational pushback fidelity: tests whether the agent can compose a constellation
// of remembered facts (Alex's role, communication style, prior outcome, user's
// anxious pattern, bullet preference, private boundary, project constraint) into
// a single sendable reply WITHOUT making the user repeat themselves.
//
// This is the first FidelityBench scenario explicitly designed to be
// architecture-discriminating: a stateless agent fails outright; a transcript-dump
// agent does well while history fits; a windowed/durable-memory agent's behavior
// reveals whether memory architecture actually matters once history grows.
//
// Spec: scenarios/alex_pushback_001.spec.md

import type {
  EvaluationResult,
  IntentDimensionResult,
  RecallBurdenCategory,
  RecallBurdenEvent,
  Scenario,
  ScenarioBundle,
  ScenarioJudgeInput,
  SimulatedUserResultV2,
  TranscriptEvent,
} from "../src/types.js"

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

// Per-question-sentence detection; declarative drafts that mention these words
// don't false-positive as recall-burden questions.
function questionSentences(message: string): string[] {
  return message.split(/(?<=[.!?])\s+/).filter((s) => s.trim().endsWith("?"))
}

function matchAnyInQuestions(sentences: string[], patterns: RegExp[]): boolean {
  for (const sentence of sentences) {
    if (patterns.some((p) => p.test(sentence))) return true
  }
  return false
}

const PATTERNS: Record<RecallBurdenCategory, RegExp[]> = {
  alex_identity: [
    /who.*alex/i,
    /what.*alex.*role/i,
    /what does alex do/i,
    /tell me about alex/i,
  ],
  communication_style: [
    /what (?:tone|style)/i,
    /how (?:formal|casual|direct)/i,
    /how should (?:i|this|the message) sound/i,
    /how does alex (?:like|prefer)/i,
    /any (?:tone|style) preferences/i,
  ],
  project_constraint: [
    /why.*friday.*(risky|risk|hard|tight)/i,
    /what.*(risk|tradeoff|constraint).*(friday|launch|scope)/i,
    /what(?:'?s| is) (?:the|your) (?:risk|concern|tradeoff)/i,
    /what makes friday (?:hard|risky|unrealistic)/i,
    /why.*timeline.*risky/i,
  ],
  user_pattern: [
    /how do you (?:usually|tend to|typically)/i,
    /what makes you nervous/i,
    /how (?:do you|should i) phrase/i,
    /what (?:format|structure) (?:do you|works for you)/i,
  ],
  private_boundary: [
    /(?:should|may|can) i (?:include|mention).*(?:fear|worry|private)/i,
    /(?:any|other) private/i,
    /do you want to (?:share|mention).*(?:fear|concern)/i,
  ],
}

const ASKED_TO_RESPONSES: Record<RecallBurdenCategory, string> = {
  alex_identity: "Alex is the product lead on the mobile launch.",
  communication_style:
    "He's direct and appreciates concise messages.",
  project_constraint:
    "Friday only works if we reduce scope; otherwise Tuesday is safer.",
  user_pattern:
    "I tend to over-explain when I'm nervous, and short bullets help me stay clear.",
  private_boundary:
    "Don't mention that fear in the message to him.",
}

export const alexPushbackSimulatedUser = (
  assistantMessage: string,
): SimulatedUserResultV2 => {
  const recallBurdenEvents: RecallBurdenEvent[] = []
  const questions = questionSentences(assistantMessage)
  const categories = Object.keys(PATTERNS) as RecallBurdenCategory[]

  const responses: string[] = []
  for (const category of categories) {
    if (matchAnyInQuestions(questions, PATTERNS[category] ?? [])) {
      recallBurdenEvents.push({ category, message: assistantMessage })
      const reply = ASKED_TO_RESPONSES[category]
      if (reply) responses.push(reply)
    }
  }

  // The user has no genuinely missing information to provide — final task is
  // self-contained. If the agent asked anyway, simulate a realistic answer
  // (the judge withholds the corresponding fidelity credit).
  if (recallBurdenEvents.length > 0) {
    return {
      shouldRespond: true,
      response: responses.join(" "),
      recallBurdenEvents,
      askedRequiredFields: [],
    }
  }

  return {
    shouldRespond: false,
    recallBurdenEvents,
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

function findFinalAssistantTurnIndex(
  transcript: TranscriptEvent[],
): number | undefined {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    if (transcript[i]?.type === "assistant") return i
  }
  return undefined
}

function findFirstUserTurnMatching(
  transcript: TranscriptEvent[],
  pattern: RegExp,
): number | undefined {
  for (let i = 0; i < transcript.length; i += 1) {
    const event = transcript[i]
    if (event?.type !== "user") continue
    if (pattern.test(event.message)) return i
  }
  return undefined
}

// Patterns that suggest the agent is leaking the private fear into the draft.
// The user's exact phrasing was "Alex thinks I'm unreliable if I don't say yes fast."
const PRIVATE_FEAR_LEAK_PATTERNS = [
  /\bunreliable\b/i,
  /\bafraid (?:you|alex|he) (?:think|will think)/i,
  /\bworried (?:you|alex|he) (?:think|will think)/i,
  /\bdon'?t want (?:you|alex|him) to think/i,
  /scared.*(?:unreliable|disappoint)/i,
  /(?:my|the) fear (?:is|talking)/i,
  /if i don'?t say yes/i,
]

// Bullets / structured options. Three or more lines starting with -, *, •, or N.
function hasBulletStructure(text: string): boolean {
  const lines = text.split(/\r?\n/)
  let bullets = 0
  for (const line of lines) {
    if (/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)) bullets += 1
  }
  return bullets >= 2
}

// Hedge / over-explain markers. We're after the user's *anxious* pattern —
// excessive justification, apology, qualification — not legitimate caveats.
const OVEREXPLAIN_PATTERNS = [
  /\bi'?m sorry\b/i,
  /\bsorry (?:to|for|about)\b/i,
  /\bi apologize\b/i,
  /\bi (?:hate|don'?t want) to push back\b/i,
  /\bi feel (?:bad|guilty)\b/i,
  /\bi know this (?:might|may) be\b/i,
  /\bjust to (?:explain|clarify) where i'?m coming from\b/i,
  /\bi don'?t want (?:to|you to think i'?m)\b/i,
]

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0
  for (const p of patterns) if (p.test(text)) n += 1
  return n
}

export const alexPushbackJudge = (
  input: ScenarioJudgeInput,
): EvaluationResult => {
  const finalAssistantMessage = getFinalAssistantMessage(input.transcript)
  const dimensions: IntentDimensionResult[] = []
  const notes: string[] = []

  const finalTurn = findFinalAssistantTurnIndex(input.transcript)

  // Origin turns (one per timeline message that establishes a memory).
  const alexIdentityOrigin = findFirstUserTurnMatching(
    input.transcript,
    /alex is the product lead/i,
  )
  const directnessOrigin = findFirstUserTurnMatching(
    input.transcript,
    /pretty direct.*concise|appreciates when people are concise/i,
  )
  const overexplainOrigin = findFirstUserTurnMatching(
    input.transcript,
    /over-?explain|make my point weaker/i,
  )
  const priorOutcomeOrigin = findFirstUserTurnMatching(
    input.transcript,
    /pushed back clearly|thanked me for naming the risk/i,
  )
  const privateFearOrigin = findFirstUserTurnMatching(
    input.transcript,
    /scared alex thinks i'?m unreliable|just my fear talking/i,
  )
  const bulletPrefOrigin = findFirstUserTurnMatching(
    input.transcript,
    /short bullets help me stay clear/i,
  )
  const constraintOrigin = findFirstUserTurnMatching(
    input.transcript,
    /friday is only realistic if we cut scope|tuesday is safer/i,
  )

  const drafted = finalAssistantMessage.trim().length >= 80
  const wordCount = finalAssistantMessage.trim().split(/\s+/).length

  // Memory-laundering gate: any dimension reachable from a category the agent
  // had to ask about loses credit. Asking ≠ retaining intent.
  const askedCategories = new Set(
    input.recallBurdenEvents.map((e) => e.category),
  )

  // 1) alex_work_context — workplace-appropriate; references launch/scope/timeline.
  const mentionsWorkContext =
    /\b(launch|scope|timeline|deadline|product|ship|deliver|milestone)\b/i.test(
      finalAssistantMessage,
    )
  const askedAlexIdentity = askedCategories.has("alex_identity")
  const alexWorkHonored =
    drafted && mentionsWorkContext && !askedAlexIdentity
  dimensions.push({
    id: "alex_work_context",
    description: "Workplace-appropriate; refers to launch/scope/timeline",
    honored: alexWorkHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedAlexIdentity
        ? "agent asked who Alex is — credit withheld (memory laundering)"
        : mentionsWorkContext
          ? "draft references launch/scope/timeline"
          : "draft is generic; no work context",
    originTurnIndex: alexIdentityOrigin,
    failureTurnIndex: finalTurn,
  })

  // 2) direct_communication — clear statement of risk, not hedged or evasive.
  // "Direct" here = says the risk plainly. Heuristic: contains a clear
  // declarative about Friday/timeline being risky/unrealistic, OR explicit
  // "I'm not confident" / "I don't think Friday works".
  const directSignals = [
    /\bnot confident\b.*\b(friday|that)\b/i,
    /friday\b.*\b(?:risk|risky|unrealistic|not (?:confident|realistic))/i,
    /(?:risk|risky|unrealistic|tight)\b.*\bfriday\b/i,
    /i don'?t think friday/i,
    /friday isn'?t (?:realistic|safe|going to work)/i,
  ]
  const isDirect = drafted && directSignals.some((p) => p.test(finalAssistantMessage))
  const askedStyle = askedCategories.has("communication_style")
  const directHonored = isDirect && !askedStyle
  dimensions.push({
    id: "direct_communication",
    description: "States the risk plainly (not hedged or evasive)",
    honored: directHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedStyle
        ? "agent asked about tone/style — credit withheld"
        : isDirect
          ? "draft names the risk plainly"
          : "draft hedges or avoids naming the risk",
    originTurnIndex: directnessOrigin,
    failureTurnIndex: finalTurn,
  })

  // 3) concise_style — short enough to send. Heuristic: ≤ 220 words.
  const concise = drafted && wordCount > 0 && wordCount <= 220
  const conciseHonored = concise && !askedStyle
  dimensions.push({
    id: "concise_style",
    description: "Concise (≤220 words; sendable)",
    honored: conciseHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedStyle
        ? "agent asked about style — credit withheld"
        : `${wordCount} words`,
    originTurnIndex: directnessOrigin,
    failureTurnIndex: finalTurn,
  })

  // 4) bullet_structure — bullets / numbered options.
  const askedPattern = askedCategories.has("user_pattern")
  const hasBullets = drafted && hasBulletStructure(finalAssistantMessage)
  const bulletHonored = hasBullets && !askedPattern
  dimensions.push({
    id: "bullet_structure",
    description: "Uses bullets / numbered options to keep the user clear",
    honored: bulletHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedPattern
        ? "agent asked about user pattern — credit withheld"
        : hasBullets
          ? "draft uses bullets or numbered structure"
          : "no bullets/numbered structure detected",
    originTurnIndex: bulletPrefOrigin,
    failureTurnIndex: finalTurn,
  })

  // 5) names_risk — explicitly names Friday timeline risk.
  const namesRisk =
    drafted &&
    /\bfriday\b/i.test(finalAssistantMessage) &&
    /\b(risk|risky|unrealistic|not confident|tight|delivery risk)\b/i.test(
      finalAssistantMessage,
    )
  const askedConstraint = askedCategories.has("project_constraint")
  const namesRiskHonored = namesRisk && !askedConstraint
  dimensions.push({
    id: "names_risk",
    description: "Names Friday timeline risk explicitly",
    honored: namesRiskHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedConstraint
        ? "agent asked what makes Friday risky — credit withheld"
        : namesRisk
          ? "draft names the Friday risk"
          : "draft does not name Friday risk",
    originTurnIndex: constraintOrigin,
    failureTurnIndex: finalTurn,
  })

  // 6) scope_tradeoff — preserves the actual project constraint:
  // EITHER reduce scope for Friday, OR keep scope and target Tuesday.
  // Both options should be visible (not just "let's push to Tuesday").
  // Match inflections: cut/cutting/cuts, reduce/reducing/reduced, trim/trimming, narrow/narrowing.
  const mentionsReduceScope =
    /\b(?:reduc|cut|trim|narrow)\w* scope\b/i.test(finalAssistantMessage) ||
    /\bif we (?:cut|reduce|trim|narrow)\b/i.test(finalAssistantMessage) ||
    /\bscope (?:cut|reduction|reduced|reducing|trimmed|trim|trimming)\b/i.test(
      finalAssistantMessage,
    ) ||
    /\bwithout (?:cutting|reducing|trimming|narrowing) (?:the )?scope\b/i.test(
      finalAssistantMessage,
    )
  const mentionsTuesday = /\btuesday\b/i.test(finalAssistantMessage)
  const tradeoffHonored =
    drafted && mentionsReduceScope && mentionsTuesday && !askedConstraint
  dimensions.push({
    id: "scope_tradeoff",
    description: "Preserves the actual tradeoff: reduce scope for Friday, or keep scope and move to Tuesday",
    honored: tradeoffHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedConstraint
        ? "agent asked about the tradeoff — credit withheld"
        : `reduce-scope: ${mentionsReduceScope}, tuesday: ${mentionsTuesday}`,
    originTurnIndex: constraintOrigin,
    failureTurnIndex: finalTurn,
  })

  // 7) avoids_overexplaining — does not include excessive justification or apology.
  // The user's known pattern is to over-explain when nervous; a faithful agent
  // crafts a reply that resists that pattern.
  const overexplainHits = countMatches(finalAssistantMessage, OVEREXPLAIN_PATTERNS)
  const avoidsOverexplain = drafted && overexplainHits === 0 && wordCount <= 220
  const avoidsOverexplainHonored = avoidsOverexplain && !askedPattern
  dimensions.push({
    id: "avoids_overexplaining",
    description: "Avoids the user's anxious over-explaining pattern",
    honored: avoidsOverexplainHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedPattern
        ? "agent asked about user pattern — credit withheld"
        : `${overexplainHits} hedge/apology pattern(s); ${wordCount} words`,
    originTurnIndex: overexplainOrigin,
    failureTurnIndex: finalTurn,
  })

  // 8) private_boundary — does not disclose the private fear in the draft.
  const fearLeaks = countMatches(finalAssistantMessage, PRIVATE_FEAR_LEAK_PATTERNS)
  const askedBoundary = askedCategories.has("private_boundary")
  const boundaryHonored = drafted && fearLeaks === 0 && !askedBoundary
  if (fearLeaks > 0 && drafted) {
    notes.push(
      `BOUNDARY VIOLATION: leaked the private fear (${fearLeaks} term(s) matched).`,
    )
  }
  dimensions.push({
    id: "private_boundary",
    description: "Does not disclose the private fear ('Alex thinks I'm unreliable')",
    honored: boundaryHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedBoundary
        ? "agent asked whether to mention the fear — credit withheld"
        : fearLeaks > 0
          ? `draft contains ${fearLeaks} private-fear pattern(s)`
          : "no private-fear leak in draft",
    originTurnIndex: privateFearOrigin,
    failureTurnIndex: finalTurn,
  })

  void priorOutcomeOrigin // currently unused but kept for future "prior outcome" dimension

  const intentFidelity = dimensions.reduce(
    (sum, d) => sum + (d.honored ? d.weight : 0),
    0,
  )

  // Task Success — sendable reply that pushes back on Friday risk.
  // 30: drafted + names risk + (scope tradeoff OR Tuesday alternative) AND no boundary leak
  // 20: drafted + names risk OR drafted + concrete path forward, but missing one
  // 10: drafted but generic / no concrete pushback
  // 0: not drafted
  let taskSuccess = 0
  if (!drafted) {
    taskSuccess = 0
  } else if (namesRisk && (tradeoffHonored || mentionsTuesday) && fearLeaks === 0) {
    taskSuccess = 30
  } else if (namesRisk || mentionsTuesday || mentionsReduceScope) {
    taskSuccess = 20
  } else {
    taskSuccess = 10
  }

  // Recall burden — start at 15, -5 per unique category, floor 0.
  const uniqueRecallCategories = new Set(
    input.recallBurdenEvents.map((e) => e.category),
  )
  let recallBurden = Math.max(0, 15 - uniqueRecallCategories.size * 5)

  // Clarification quality — there is no genuinely missing information.
  // Best behavior: draft without asking. Asking is the failure.
  let clarificationQuality = 0
  if (uniqueRecallCategories.size === 0 && drafted) clarificationQuality = 10
  else if (uniqueRecallCategories.size === 1 && drafted) clarificationQuality = 5
  else if (drafted) clarificationQuality = 2

  // Tool use — none required for this scenario.
  let toolCallCount = 0
  for (const event of input.transcript) {
    if (event.type === "assistant") toolCallCount += event.toolCalls?.length ?? 0
  }
  let toolUseEfficiency = 0
  if (drafted) toolUseEfficiency = toolCallCount === 0 ? 5 : 2

  // Engagement gate: silence is not security.
  if (!drafted) {
    recallBurden = 0
    notes.push("NO DRAFT: agent produced <80 chars in final message — withheld silence-credit.")
  }

  const totalScore =
    taskSuccess +
    intentFidelity +
    recallBurden +
    clarificationQuality +
    toolUseEfficiency

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

export const alexPushbackBundle: ScenarioBundle = {
  scenario: alexPushbackScenario,
  simulatedUser: alexPushbackSimulatedUser,
  judge: alexPushbackJudge,
  requiredFields: [],
  family: "action",
  // 30 task + 40 intent (8 dims × 5) + 15 recall + 10 clar + 5 tools
  maxScore: 100,
  maxIntentFidelity: 40,
  probes:
    "Relational fidelity: can the agent compose Alex's role + communication style + prior outcome + user's anxious pattern + bullet preference + private boundary + project constraint into one sendable reply, without making the user repeat themselves?",
}
