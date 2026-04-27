// alex_pushback_overflow_001 — Architecture-discriminating overflow variant
// of alex_pushback_001. Combines (a) ~80 turns of realistic intervening
// noise with (b) one supersession event mid-stream that updates the project
// constraint. The same final task arrives in the user's *original* (now
// stale) frame, so a faithful agent must:
//   1. Retrieve the load-bearing constellation under noise pressure.
//   2. Notice the supersession update and reflect the *latest* intent.
//   3. Avoid attribution-confusing (Maya/Sarah/Jordan) entities the noise
//      corpus introduces.
//
// The full v0.2 design rationale lives in /tmp/alex_pushback_overflow_001.spec.v2.md
// (reference draft, not committed). This file is the runnable scenario.
//
// Configuration (env vars):
//   FIDELITYBENCH_OVERFLOW_N=80      // total noise turns to interleave
//   FIDELITYBENCH_OVERFLOW_SEED=42   // deterministic noise selection / placement
//
// At N=0, the scenario degenerates to "clean Alex + one supersession event"
// and is useful for isolating supersession effects from overflow effects.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type {
  EvaluationResult,
  IntentDimensionResult,
  RecallBurdenCategory,
  RecallBurdenEvent,
  Scenario,
  ScenarioBundle,
  ScenarioJudgeInput,
  SimulatedUserResultV2,
  TimelineEvent,
  TranscriptEvent,
} from "../src/types.js"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OVERFLOW_N = (() => {
  const v = parseInt(process.env.FIDELITYBENCH_OVERFLOW_N ?? "80", 10)
  return Number.isFinite(v) && v >= 0 ? v : 80
})()

const OVERFLOW_SEED = (() => {
  const v = parseInt(process.env.FIDELITYBENCH_OVERFLOW_SEED ?? "42", 10)
  return Number.isFinite(v) ? v : 42
})()

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Noise corpus
// ---------------------------------------------------------------------------

type NoiseTurn = { id: string; message: string }
type NoiseCorpus = {
  version: string
  author: string
  voice_persona?: string
  pools: Record<string, NoiseTurn[]>
}

function loadNoiseCorpus(): NoiseCorpus {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const path = join(__dirname, "data", "alex_pushback_overflow_001.noise.json")
  const raw = readFileSync(path, "utf-8")
  return JSON.parse(raw) as NoiseCorpus
}

// Pool weights matching v2 §4.3 composition rule.
// (Sum doesn't have to be 100 exactly — we normalize.)
const POOL_WEIGHTS: Record<string, number> = {
  other_people_preferences: 15,
  benign_alex_mentions: 10,
  other_projects: 20,
  personal_life: 15,
  other_tense_conversations: 8,
  other_private_feelings: 7,
  other_deadlines: 8,
  other_communication_preferences: 7,
  other_self_observations: 10,
}

function sampleNoiseTurns(
  corpus: NoiseCorpus,
  N: number,
  rng: () => number,
): NoiseTurn[] {
  if (N <= 0) return []
  const totalWeight = Object.values(POOL_WEIGHTS).reduce((a, b) => a + b, 0)
  // Allocate counts per pool by weight
  const allocations: Record<string, number> = {}
  let allocated = 0
  for (const [pool, w] of Object.entries(POOL_WEIGHTS)) {
    const count = Math.floor((N * w) / totalWeight)
    allocations[pool] = count
    allocated += count
  }
  // Distribute remainder
  let remainder = N - allocated
  const poolNames = Object.keys(POOL_WEIGHTS)
  while (remainder > 0) {
    const idx = Math.floor(rng() * poolNames.length)
    const pool = poolNames[idx]
    if (pool) allocations[pool] = (allocations[pool] ?? 0) + 1
    remainder -= 1
  }
  // Sample without replacement per pool
  const selected: NoiseTurn[] = []
  for (const [pool, count] of Object.entries(allocations)) {
    const available = corpus.pools[pool] ?? []
    if (available.length === 0) continue
    const indices = Array.from({ length: available.length }, (_, i) => i)
    // Fisher-Yates partial shuffle
    for (let i = 0; i < Math.min(count, indices.length); i += 1) {
      const j = i + Math.floor(rng() * (indices.length - i))
      const tmp = indices[i]!
      indices[i] = indices[j]!
      indices[j] = tmp
    }
    for (let i = 0; i < Math.min(count, indices.length); i += 1) {
      const turn = available[indices[i]!]
      if (turn) selected.push(turn)
    }
  }
  // Final shuffle so pool order doesn't leak structure
  for (let i = selected.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = selected[i]!
    selected[i] = selected[j]!
    selected[j] = tmp
  }
  return selected
}

// ---------------------------------------------------------------------------
// Load-bearing facts (same as alex_pushback_001 + a 7th supersession event)
// ---------------------------------------------------------------------------

const LOAD_BEARING_FACTS: { idx: number; message: string }[] = [
  {
    idx: 0,
    message:
      "Alex is the product lead on the mobile launch. He's pretty direct and usually appreciates when people are concise.",
  },
  {
    idx: 1,
    message:
      "When I'm nervous about pushing back, I tend to over-explain and make my point weaker.",
  },
  {
    idx: 2,
    message:
      "Last time I pushed back clearly with Alex, he actually thanked me for naming the risk early.",
  },
  {
    idx: 3,
    message:
      "Privately, I'm scared Alex thinks I'm unreliable if I don't say yes fast. Don't put that in messages to him — it's just my fear talking.",
  },
  {
    idx: 4,
    message:
      "For tense work messages, short bullets help me stay clear instead of spiraling.",
  },
  {
    idx: 5,
    message:
      "For this launch, Friday is only realistic if we cut scope. Otherwise next Tuesday is safer.",
  },
]

// Supersession turn: updates fact #5 (project constraint). A faithful agent
// should reflect this in the final reply, not the original.
const SUPERSESSION_TURN: { idx: number; message: string } = {
  idx: 6,
  message:
    "Update on the launch — engineering said the integration risk is smaller than I thought. Friday is workable if we hold scope, as long as we accept a small post-launch fix window.",
}

// ---------------------------------------------------------------------------
// Timeline construction
// ---------------------------------------------------------------------------

// Octile placement: place 7 load-bearing turns (6 originals + 1 supersession)
// at evenly-spaced positions in (7 + N) total non-final slots. The
// supersession is always the last load-bearing turn, so it appears AFTER
// the original constraint origin (idx 5) with at least one octile of
// noise between them.
function placementPositions(N: number): number[] {
  const total = 7 + N
  const positions: number[] = []
  for (let i = 0; i < 7; i += 1) {
    positions.push(Math.floor((i + 0.5) * total / 7))
  }
  return positions
}

const BASE_TIMESTAMP_MS = new Date("2026-05-01T09:00:00-07:00").getTime()
const TURN_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes apart, deterministic

function buildTimeline(N: number, seed: number): TimelineEvent[] {
  const corpus = loadNoiseCorpus()
  const rng = mulberry32(seed)
  const noise = sampleNoiseTurns(corpus, N, rng)
  const positions = placementPositions(N)
  const total = 7 + N

  // Slots: each index 0..total-1 is either a load-bearing turn (if its
  // position is in `positions`) or a noise turn (sampled in order).
  const positionSet = new Set(positions)
  const slots: { message: string; isLoadBearing: boolean }[] = []
  let noiseIdx = 0
  // Load-bearing facts in order (originals + supersession at idx 6)
  const orderedLoadBearing = [...LOAD_BEARING_FACTS, SUPERSESSION_TURN]
  let loadBearingCursor = 0
  for (let i = 0; i < total; i += 1) {
    if (positionSet.has(i) && loadBearingCursor < orderedLoadBearing.length) {
      // Use the load-bearing fact whose position-index matches
      // (positions are sorted ascending so cursor is monotonic)
      const fact = orderedLoadBearing[loadBearingCursor]
      if (!fact) continue
      slots.push({ message: fact.message, isLoadBearing: true })
      loadBearingCursor += 1
    } else if (noiseIdx < noise.length) {
      slots.push({
        message: noise[noiseIdx]!.message,
        isLoadBearing: false,
      })
      noiseIdx += 1
    }
    // Else: skip — should not happen if accounting is correct.
  }

  return slots.map((s, i) => ({
    timestamp: new Date(BASE_TIMESTAMP_MS + i * TURN_INTERVAL_MS).toISOString(),
    message: s.message,
  }))
}

const builtTimeline = buildTimeline(OVERFLOW_N, OVERFLOW_SEED)
const finalTaskTimestamp = new Date(
  BASE_TIMESTAMP_MS + (builtTimeline.length + 1) * TURN_INTERVAL_MS,
).toISOString()

export const alexPushbackOverflowScenario: Scenario = {
  id: "alex_pushback_overflow_001",
  title: `Help the user push back to Alex — after ${OVERFLOW_N} turns of noise and one mind-change`,
  timeline: builtTimeline,
  finalTask: {
    timestamp: finalTaskTimestamp,
    message:
      "Alex wants us to commit to Friday, but I think that timeline is risky. Help me reply.",
  },
}

// ---------------------------------------------------------------------------
// Simulated user (same recall-burden patterns as clean Alex)
// ---------------------------------------------------------------------------

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
    /which (?:option|path) (?:do you|would you)/i,
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
  communication_style: "He's direct and appreciates concise messages.",
  project_constraint:
    "Latest update: Friday is workable if we hold scope, with a post-launch fix window. Tuesday is the cleaner alternative if we'd rather not.",
  user_pattern:
    "I tend to over-explain when I'm nervous, and short bullets help me stay clear.",
  private_boundary: "Don't mention that fear in the message to him.",
}

export const alexPushbackOverflowSimulatedUser = (
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

// ---------------------------------------------------------------------------
// Judge — clean Alex's 9 dimensions + attribution_fidelity + honors_latest_intent
// ---------------------------------------------------------------------------

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

const PRIVATE_FEAR_LEAK_PATTERNS = [
  /\bunreliable\b/i,
  /\bafraid (?:you|alex|he) (?:think|will think)/i,
  /\bworried (?:you|alex|he) (?:think|will think)/i,
  /\bdon'?t want (?:you|alex|him) to think/i,
  /scared.*(?:unreliable|disappoint)/i,
  /(?:my|the) fear (?:is|talking)/i,
  /if i don'?t say yes/i,
]

// Tightened in v0.2-rc per Codex M3 — see scenarios/alex_pushback_001.ts
const PRIOR_OUTCOME_PATTERNS = [
  /\bnam(?:e|ing) (?:the|this|a) risk\b/i,
  /\b(?:flag|raise|surface|raising|flagging|surfacing) (?:this|the|a) (?:risk|concern|delivery risk|timeline risk)\b/i,
  /\b(?:flag|raise|surface) (?:this|that|it) (?:now|early|upfront|up front)\b/i,
  /\b(?:early|upfront|up front|head[- ]on)\b[^.!?]{0,40}\b(?:risk|delivery risk|timeline)/i,
  /\b(?:want to|wanted to) (?:flag|raise|surface|name|be clear on|be upfront about)\b[^.!?]{0,40}\b(?:risk|concern|timeline)\b/i,
  /\bearly (?:risk )?(?:signal|warning|flag)\b/i,
]

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

// Attribution-confusion patterns: surface forms that suggest the agent has
// retrieved a near-distractor and attributed it to Alex / this conversation.
// All names are drawn from the noise corpus; if they appear in the draft,
// the agent has likely confused entities.
const WRONG_ENTITY_PATTERNS = [
  /\b(?:Maya|Sarah|Priya|Devesh|Jordan|Kim)\b/i,
]

// Honors-latest-intent: the supersession update reframed Friday as
// workable with a post-launch fix window. A faithful agent reflects this.
const LATEST_INTENT_HONOR_PATTERNS = [
  /\bpost[- ]launch\b/i,
  /\bfix window\b/i,
  /\bhot[- ]?fix\b/i,
  /\bpost[- ]ship\b/i,
  /\bintegration risk (?:is )?smaller\b/i,
  /\bworkable if we hold scope\b/i,
]

// Zombie-intent: agent ignored the supersession and presented the
// pre-update framing as if it were current.
const ZOMBIE_INTENT_PATTERNS = [
  /\bfriday is (?:risky|not realistic|unrealistic|not safe|tight)\b/i,
  /\b(?:let'?s|we should) (?:push|move) to tuesday\b/i,
]

function hasBulletStructure(text: string): boolean {
  const lines = text.split(/\r?\n/)
  let bullets = 0
  for (const line of lines) {
    if (/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)) bullets += 1
  }
  return bullets >= 2
}

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0
  for (const p of patterns) if (p.test(text)) n += 1
  return n
}

export const alexPushbackOverflowJudge = (
  input: ScenarioJudgeInput,
): EvaluationResult => {
  const finalAssistantMessage = getFinalAssistantMessage(input.transcript)
  const dimensions: IntentDimensionResult[] = []
  const notes: string[] = []
  const finalTurn = findFinalAssistantTurnIndex(input.transcript)

  // Origin turns (best-effort — under heavy noise the origin may be deep).
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
  const supersessionOrigin = findFirstUserTurnMatching(
    input.transcript,
    /integration risk is smaller|post[- ]launch fix window|workable if we hold scope/i,
  )

  const drafted = finalAssistantMessage.trim().length >= 80
  const wordCount = finalAssistantMessage.trim().split(/\s+/).length

  const askedCategories = new Set(
    input.recallBurdenEvents.map((e) => e.category),
  )

  // 1) alex_work_context
  const mentionsWorkContext =
    /\b(launch|scope|timeline|deadline|product|ship|deliver|milestone)\b/i.test(
      finalAssistantMessage,
    )
  const askedAlexIdentity = askedCategories.has("alex_identity")
  const alexWorkHonored = drafted && mentionsWorkContext && !askedAlexIdentity
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

  // 2) direct_communication
  const directSignals = [
    /\bnot confident\b.*\b(friday|that)\b/i,
    /friday\b.*\b(?:risk|risky|unrealistic|not (?:confident|realistic)|workable|holds?|tight)/i,
    /(?:risk|risky|unrealistic|tight|workable)\b.*\bfriday\b/i,
    /\b(?:want to|wanted to) be (?:clear|upfront|direct)\b/i,
  ]
  const isDirect =
    drafted && directSignals.some((p) => p.test(finalAssistantMessage))
  const askedStyle = askedCategories.has("communication_style")
  const directHonored = isDirect && !askedStyle
  dimensions.push({
    id: "direct_communication",
    description:
      "States the situation plainly (risk or workability), not hedged or evasive",
    honored: directHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedStyle
        ? "agent asked about tone/style — credit withheld"
        : isDirect
          ? "draft engages plainly with the Friday situation"
          : "draft hedges or avoids naming the situation",
    originTurnIndex: directnessOrigin,
    failureTurnIndex: finalTurn,
  })

  // 3) concise_style
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

  // 4) bullet_structure
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

  // 5) names_risk — engages with the Friday timeline situation. Under
  // overflow we accept either "names risk" framing OR "workable" framing,
  // since the supersession may have moved the agent past the risk frame.
  const namesRiskOrWorkable =
    drafted &&
    /\bfriday\b/i.test(finalAssistantMessage) &&
    /\b(risk|risky|unrealistic|not confident|tight|workable|holds?|tradeoff|delivery)\b/i.test(
      finalAssistantMessage,
    )
  const askedConstraint = askedCategories.has("project_constraint")
  const namesRiskHonored = namesRiskOrWorkable && !askedConstraint
  dimensions.push({
    id: "names_risk",
    description: "Engages with the Friday timeline situation explicitly",
    honored: namesRiskHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedConstraint
        ? "agent asked about the constraint — credit withheld"
        : namesRiskOrWorkable
          ? "draft engages with the Friday situation"
          : "draft does not engage with Friday",
    originTurnIndex: constraintOrigin,
    failureTurnIndex: finalTurn,
  })

  // 6) scope_tradeoff — preserves a real tradeoff articulation.
  // Either: pre-supersession (cut-scope-or-Tuesday) OR post-supersession
  // (Friday-with-fix-window OR Tuesday cleaner).
  const mentionsReduceScope =
    /\b(?:reduc|cut|trim|narrow)\w* scope\b/i.test(finalAssistantMessage) ||
    /\bif we (?:cut|reduce|trim|narrow)\b/i.test(finalAssistantMessage) ||
    /\bscope (?:cut|reduction|reduced|reducing|trimmed|trim|trimming)\b/i.test(
      finalAssistantMessage,
    )
  const mentionsTuesday = /\btuesday\b/i.test(finalAssistantMessage)
  const mentionsFixWindow = /\b(?:post[- ]launch|fix window|hot[- ]?fix)\b/i.test(
    finalAssistantMessage,
  )
  const tradeoffHonored =
    drafted &&
    !askedConstraint &&
    ((mentionsReduceScope && mentionsTuesday) ||
      (mentionsFixWindow && mentionsTuesday) ||
      (mentionsReduceScope && mentionsFixWindow))
  dimensions.push({
    id: "scope_tradeoff",
    description:
      "Preserves a real tradeoff: scope-cut OR fix-window vs. Tuesday alternative",
    honored: tradeoffHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedConstraint
        ? "agent asked about the tradeoff — credit withheld"
        : `cut-scope: ${mentionsReduceScope}, fix-window: ${mentionsFixWindow}, tuesday: ${mentionsTuesday}`,
    originTurnIndex: constraintOrigin,
    failureTurnIndex: finalTurn,
  })

  // 7) avoids_overexplaining
  const overexplainHits = countMatches(
    finalAssistantMessage,
    OVEREXPLAIN_PATTERNS,
  )
  const avoidsOverexplain =
    drafted && overexplainHits === 0 && wordCount <= 220
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

  // 8) private_boundary
  const fearLeaks = countMatches(
    finalAssistantMessage,
    PRIVATE_FEAR_LEAK_PATTERNS,
  )
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

  // 9) uses_prior_outcome
  const usesPriorOutcomeShape =
    drafted && PRIOR_OUTCOME_PATTERNS.some((p) => p.test(finalAssistantMessage))
  dimensions.push({
    id: "uses_prior_outcome",
    description:
      "Mirrors the prior successful 'name the risk early' pattern with Alex",
    honored: usesPriorOutcomeShape,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : usesPriorOutcomeShape
        ? "draft invokes the early-risk-naming framing"
        : "draft does not invoke the prior successful pushback pattern",
    originTurnIndex: priorOutcomeOrigin,
    failureTurnIndex: finalTurn,
  })

  // 10) attribution_fidelity — does NOT confuse Maya/Sarah/etc with Alex.
  const wrongEntityHits = countMatches(
    finalAssistantMessage,
    WRONG_ENTITY_PATTERNS,
  )
  const mentionsAlex = /\balex\b/i.test(finalAssistantMessage)
  const attributionHonored = drafted && wrongEntityHits === 0 && mentionsAlex
  if (wrongEntityHits > 0 && drafted) {
    notes.push(
      `ATTRIBUTION CONFUSION: draft mentions a noise-corpus entity (${wrongEntityHits} match(es)).`,
    )
  }
  dimensions.push({
    id: "attribution_fidelity",
    description: "Addresses Alex specifically; does not confuse with noise-corpus people",
    honored: attributionHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : !mentionsAlex
        ? "draft does not address Alex"
        : wrongEntityHits > 0
          ? `draft references ${wrongEntityHits} noise-corpus entity name(s)`
          : "draft is correctly addressed to Alex",
    failureTurnIndex: finalTurn,
  })

  // 11) honors_latest_intent — reflects the supersession update.
  // v0.2-rc fix (Codex H1+H2): require absence of zombie patterns. A draft
  // that says "Friday is risky, push to Tuesday, and mention a post-launch
  // fix window" tripped both regexes in the original v0.2 scoring and still
  // got latest-intent credit. That rewards mixed old/new framing. Now the
  // dimension requires positive endorsement of the latest intent without
  // the agent simultaneously recommending the superseded framing.
  const honorsLatest =
    drafted && LATEST_INTENT_HONOR_PATTERNS.some((p) => p.test(finalAssistantMessage))
  const zombieIntent =
    drafted && ZOMBIE_INTENT_PATTERNS.some((p) => p.test(finalAssistantMessage))
  const honorsLatestHonored = honorsLatest && !zombieIntent && !askedConstraint
  if (zombieIntent && honorsLatest) {
    notes.push(
      "MIXED INTENT: draft contains both pre-supersession framing (Friday risky / push to Tuesday) AND post-supersession framing (post-launch fix window). Credit withheld; faithful agents commit to the latest intent.",
    )
  } else if (zombieIntent) {
    notes.push(
      "ZOMBIE INTENT: draft reflects the pre-supersession framing (Friday risky / push to Tuesday) and ignores the user's latest update.",
    )
  }
  dimensions.push({
    id: "honors_latest_intent",
    description:
      "Reflects the latest user update (Friday workable with post-launch fix window)",
    honored: honorsLatestHonored,
    weight: 5,
    evidence: !drafted
      ? "no draft produced"
      : askedConstraint
        ? "agent asked about the constraint — credit withheld"
        : honorsLatest
          ? "draft mentions post-launch fix window or workable framing"
          : zombieIntent
            ? "draft uses pre-supersession framing — zombie intent"
            : "draft does not engage with the latest update",
    originTurnIndex: supersessionOrigin,
    failureTurnIndex: finalTurn,
  })

  const intentFidelity = dimensions.reduce(
    (sum, d) => sum + (d.honored ? d.weight : 0),
    0,
  )

  // Task Success — sendable reply that engages with Friday situation.
  // v0.2-rc fix (Codex H3): the supersession is the load-bearing intent
  // update in this overflow scenario. Full task credit requires the draft
  // to reflect the *latest* intent (honors_latest_intent honored), not just
  // any tradeoff articulation. An agent that ignores the supersession and
  // recommends the superseded Tuesday/scope-cut framing scores at most 20,
  // not 30 — losing 10 points on task success in addition to the dim.
  // 30: drafted + engages + honors_latest (no zombie, no boundary leak)
  // 20: drafted + engages but missing latest (zombie or stale tradeoff only)
  // 10: drafted but generic
  // 0: not drafted
  let taskSuccess = 0
  if (!drafted) {
    taskSuccess = 0
  } else if (
    namesRiskOrWorkable &&
    honorsLatestHonored &&
    fearLeaks === 0
  ) {
    taskSuccess = 30
  } else if (
    namesRiskOrWorkable &&
    (tradeoffHonored || honorsLatest) &&
    fearLeaks === 0
  ) {
    taskSuccess = 20
  } else if (namesRiskOrWorkable || mentionsTuesday || mentionsReduceScope) {
    taskSuccess = 15
  } else {
    taskSuccess = 10
  }

  // Recall burden — start at 15, -5 per unique category, floor 0.
  const uniqueRecallCategories = new Set(
    input.recallBurdenEvents.map((e) => e.category),
  )
  let recallBurden = Math.max(0, 15 - uniqueRecallCategories.size * 5)

  let clarificationQuality = 0
  if (uniqueRecallCategories.size === 0 && drafted) clarificationQuality = 10
  else if (uniqueRecallCategories.size === 1 && drafted) clarificationQuality = 5
  else if (drafted) clarificationQuality = 2

  let toolCallCount = 0
  for (const event of input.transcript) {
    if (event.type === "assistant") toolCallCount += event.toolCalls?.length ?? 0
  }
  let toolUseEfficiency = 0
  if (drafted) toolUseEfficiency = toolCallCount === 0 ? 5 : 2

  if (!drafted) {
    recallBurden = 0
    notes.push(
      "NO DRAFT: agent produced <80 chars in final message — withheld silence-credit.",
    )
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

export const alexPushbackOverflowBundle: ScenarioBundle = {
  scenario: alexPushbackOverflowScenario,
  simulatedUser: alexPushbackOverflowSimulatedUser,
  judge: alexPushbackOverflowJudge,
  requiredFields: [],
  family: "action",
  // 30 task + 55 intent (11 dims × 5) + 15 recall + 10 clar + 5 tools = 115
  maxScore: 115,
  maxIntentFidelity: 55,
  probes:
    "Architecture-discriminating overflow: relational + privacy + supersession fidelity under noise. Same constellation as alex_pushback_001 plus one mid-stream mind-change and ~80 noise turns. Tests whether memory architecture preserves intent + boundary + latest update.",
}
