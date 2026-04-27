import type {
  AggregatedResult,
  EvaluationResult,
  IntentDimensionResult,
  RecallBurdenCategory,
  ScenarioBundle,
  ToolCall,
  TranscriptEvent,
} from "./types.js"

const DEFAULT_MAX_TOTAL = 100
const DEFAULT_MAX_INTENT = 35

function isAggregated(r: EvaluationResult): r is AggregatedResult {
  return "trials" in r && (r as AggregatedResult).trials > 1
}

function formatScore(r: EvaluationResult, value: number, max: number, sd?: number): string {
  if (isAggregated(r) && sd !== undefined && sd > 0) {
    return `${value}±${sd}/${max}`
  }
  return `${value}/${max}`
}

function uniqueRecallCategories(result: EvaluationResult): RecallBurdenCategory[] {
  return [...new Set(result.recallBurdenEvents.map((event) => event.category))]
}

function getToolCalls(transcript: TranscriptEvent[]): string[] {
  const calls: string[] = []
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) calls.push(call.tool)
  }
  return calls
}

function pad(
  value: string | number,
  width: number,
  alignment: "start" | "end" = "end",
) {
  const text = String(value)
  return alignment === "start" ? text.padEnd(width) : text.padStart(width)
}

function formatHeldReservation(result: EvaluationResult): string {
  if (!result.heldReservation) return "none"
  const r = result.heldReservation
  return `${r.restaurantId} on ${r.date} at ${r.time} for ${r.partySize}`
}

function truncate(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  if (oneLine.length <= maxChars) return oneLine
  return `${oneLine.slice(0, maxChars - 1)}…`
}

function turnExcerpt(
  transcript: TranscriptEvent[],
  index: number | undefined,
  maxChars = 110,
): string | undefined {
  if (index === undefined) return undefined
  const event = transcript[index]
  if (!event) return undefined
  if (event.type === "user") {
    return `turn ${index} (user, ${event.timestamp}): "${truncate(event.message, maxChars)}"`
  }
  if (event.type === "assistant") {
    const calls = event.toolCalls ?? []
    if (calls.length > 0) {
      const summary = calls
        .map((c) => `${c.tool} ${JSON.stringify(c.args)}`)
        .join("; ")
      return `turn ${index} (assistant): ${truncate(summary, maxChars)}`
    }
    return `turn ${index} (assistant): "${truncate(event.message, maxChars)}"`
  }
  return `turn ${index} (tool_result)`
}

function getKeyBehavior(result: EvaluationResult): string {
  if (result.invalidReason) return "invalid run"
  const recallCategories = uniqueRecallCategories(result)
  if (recallCategories.length > 0) {
    return `asked user to repeat: ${recallCategories.join(", ")}`
  }
  if (result.heldReservation && result.clarificationQuality >= 10) {
    return "asked only for missing field and placed a hold"
  }
  if (result.heldReservation) return "used tools and placed a reservation hold"
  if (result.toolUseEfficiency > 0) return "used tools but did not complete a hold"
  return "no tool action (response-only scenario)"
}

export function printAggregateSummary(
  results: EvaluationResult[],
  bundles?: ScenarioBundle[],
) {
  if (results.length === 0) return
  const byAgent = new Map<string, { total: number; n: number; per: Record<string, number> }>()
  for (const r of results) {
    const e = byAgent.get(r.agentName) ?? { total: 0, n: 0, per: {} }
    e.total += r.totalScore
    e.n += 1
    e.per[r.scenarioId] = r.totalScore
    byAgent.set(r.agentName, e)
  }
  const scenarioIds = [...new Set(results.map((r) => r.scenarioId))]
  console.log("")
  console.log("Aggregate (score per agent across scenarios)")
  const header =
    `${pad("Agent", 22, "start")}` +
    scenarioIds.map((id) => pad(id.slice(0, 14), 16)).join("") +
    pad("Total", 10)
  console.log(header)
  for (const [agentName, entry] of byAgent.entries()) {
    const row =
      `${pad(agentName, 22, "start")}` +
      scenarioIds.map((id) => pad(entry.per[id] ?? "—", 16)).join("") +
      pad(entry.total, 10)
    console.log(row)
  }

  // Family split: group by scenario.family. Companion-style agents may
  // legitimately score 0 on action scenarios but well on reflection — the
  // blended total hides this. The split makes the regime clear.
  if (!bundles || bundles.length === 0) return
  const familyOf = new Map<string, "action" | "reflection">()
  for (const b of bundles) familyOf.set(b.scenario.id, b.family)
  const families: Array<"action" | "reflection"> = []
  for (const f of familyOf.values()) {
    if (!families.includes(f)) families.push(f)
  }
  if (families.length < 2) return // no split needed if only one family
  console.log("")
  console.log("By family")
  const familyHeader =
    `${pad("Agent", 22, "start")}` +
    families.map((f) => pad(f, 14)).join("") +
    pad("Total", 10)
  console.log(familyHeader)
  for (const [agentName, entry] of byAgent.entries()) {
    const familyTotals: Record<string, number> = {}
    for (const f of families) familyTotals[f] = 0
    for (const r of results.filter((x) => x.agentName === agentName)) {
      const fam = familyOf.get(r.scenarioId)
      if (!fam) continue
      familyTotals[fam] = (familyTotals[fam] ?? 0) + r.totalScore
    }
    const row =
      `${pad(agentName, 22, "start")}` +
      families.map((f) => pad(familyTotals[f] ?? 0, 14)).join("") +
      pad(entry.total, 10)
    console.log(row)
  }
}

function getToolCallAtTurn(
  transcript: TranscriptEvent[],
  index: number | undefined,
): ToolCall | undefined {
  if (index === undefined) return undefined
  const event = transcript[index]
  if (event?.type !== "assistant") return undefined
  return event.toolCalls?.[0]
}

function diffToolArgs(
  thisCall: ToolCall,
  refCall: ToolCall,
): string | undefined {
  if (thisCall.tool !== refCall.tool) return undefined
  const thisArgs = thisCall.args as Record<string, unknown>
  const refArgs = refCall.args as Record<string, unknown>
  const parts: string[] = []
  const keys = new Set([...Object.keys(thisArgs), ...Object.keys(refArgs)])
  for (const key of keys) {
    const a = thisArgs[key]
    const b = refArgs[key]
    if (a === undefined && b !== undefined) {
      parts.push(`+ ${key}: ${JSON.stringify(b)}`)
    } else if (a !== undefined && b === undefined) {
      parts.push(`- ${key}`)
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      parts.push(`${key}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
    }
  }
  if (parts.length === 0) return undefined
  return parts.join("    ")
}

function printContrast(
  result: EvaluationResult,
  oracle: EvaluationResult | undefined,
) {
  if (!oracle) {
    if (
      result.intentDimensionResults?.some((d) => !d.honored) ||
      result.recallBurdenEvents.length > 0
    ) {
      console.log(
        "Contrast: pass --include-oracle to compare against the rubric ceiling.",
      )
    }
    return
  }

  const oracleDimsById = new Map<string, IntentDimensionResult>()
  for (const dim of oracle.intentDimensionResults ?? []) {
    oracleDimsById.set(dim.id, dim)
  }

  // Only render dimensions where THIS lost AND Oracle honored — those are
  // the instructive deltas.
  const violations = (result.intentDimensionResults ?? []).filter((dim) => {
    if (dim.honored) return false
    const ref = oracleDimsById.get(dim.id)
    return !!ref?.honored
  })

  if (violations.length === 0) return

  console.log(
    "Contrast — vs OracleAgent (same dimension, Oracle's turn):",
  )
  for (const dim of violations) {
    const ref = oracleDimsById.get(dim.id)
    if (!ref) continue
    console.log(`  ${dim.id}`)
    const thisExcerpt = turnExcerpt(result.transcript, dim.failureTurnIndex)
    const refExcerpt = turnExcerpt(oracle.transcript, ref.failureTurnIndex)
    if (thisExcerpt) console.log(`    THIS  ${thisExcerpt}`)
    if (refExcerpt) console.log(`    REF   ${refExcerpt}`)
    const thisCall = getToolCallAtTurn(result.transcript, dim.failureTurnIndex)
    const refCall = getToolCallAtTurn(oracle.transcript, ref.failureTurnIndex)
    if (thisCall && refCall) {
      const diff = diffToolArgs(thisCall, refCall)
      if (diff) console.log(`    diff: ${diff}`)
    }
  }
}

export type PrintReportOptions = {
  // When false, suppresses the Diagnosis and Contrast blocks (recovers
  // the pre-v1.6 report shape). Default true.
  diagnose?: boolean
}

export function printReport(
  results: EvaluationResult[],
  bundle?: ScenarioBundle,
  options: PrintReportOptions = {},
) {
  const diagnose = options.diagnose !== false
  console.log("FidelityBench v1.6")
  const scenarioId = results[0]?.scenarioId
  const maxTotal = bundle?.maxScore ?? DEFAULT_MAX_TOTAL
  const maxIntent = bundle?.maxIntentFidelity ?? DEFAULT_MAX_INTENT
  if (scenarioId) console.log(`Scenario: ${scenarioId}`)
  if (bundle?.probes) console.log(`Probes:   ${bundle.probes}`)
  console.log("")

  const header =
    `${pad("Agent", 22, "start")}` +
    `${pad("Score", 16)}` +
    `${pad("Task", 12)}` +
    `${pad("Intent", 14)}` +
    `${pad("RecallBurden", 16)}` +
    `${pad("Clarification", 16)}` +
    `${pad("Tools", 10)}`
  console.log(header)

  for (const result of results) {
    const sd = isAggregated(result) ? result.stddev : undefined
    const row =
      `${pad(result.agentName, 22, "start")}` +
      `${pad(formatScore(result, result.totalScore, maxTotal, sd?.totalScore), 16)}` +
      `${pad(formatScore(result, result.taskSuccess, 30, sd?.taskSuccess), 12)}` +
      `${pad(formatScore(result, result.intentFidelity, maxIntent, sd?.intentFidelity), 14)}` +
      `${pad(formatScore(result, result.recallBurden, 20, sd?.recallBurden), 16)}` +
      `${pad(formatScore(result, result.clarificationQuality, 10, sd?.clarificationQuality), 16)}` +
      `${pad(formatScore(result, result.toolUseEfficiency, 5, sd?.toolUseEfficiency), 10)}`
    console.log(row)
  }
  if (results.some(isAggregated)) {
    const trials = (results.find(isAggregated) as AggregatedResult).trials
    console.log(`(N=${trials} trials for nondeterministic agents; ± is sample stddev)`)
  }

  // Oracle is the contrast partner. Skip if absent or if THIS agent IS Oracle.
  const oracleResult = results.find((r) => r.agentName === "OracleAgent")

  for (const result of results) {
    const recallCategories = uniqueRecallCategories(result)
    console.log("")
    console.log(`── ${result.agentName} ──`)
    if (result.invalidReason) {
      console.log(result.invalidReason)
    }
    if (result.selectedRestaurantId !== undefined) {
      console.log(`Selected restaurant: ${result.selectedRestaurantId ?? "none"}`)
    }
    if (result.heldReservation !== undefined) {
      console.log(`Held reservation: ${formatHeldReservation(result)}`)
    }
    console.log(
      `Recall burden categories: ${
        recallCategories.length > 0 ? recallCategories.join(", ") : "none"
      }`,
    )
    const tools = getToolCalls(result.transcript)
    if (tools.length > 0) console.log(`Tool calls: ${tools.join(", ")}`)
    console.log(`Key behavior: ${getKeyBehavior(result)}`)

    if (result.intentDimensionResults && result.intentDimensionResults.length > 0) {
      console.log("Intent dimensions:")
      for (const dim of result.intentDimensionResults) {
        const marker = dim.honored ? "✓" : "✗"
        const earned = dim.honored ? dim.weight : 0
        console.log(
          `  ${marker} (${earned}/${dim.weight}) ${dim.description} — ${dim.evidence}`,
        )
      }
    }

    if (diagnose) {
      printDiagnosis(result)
      if (result.agentName !== "OracleAgent") {
        printContrast(result, oracleResult)
      }
    }

    if (result.notes && result.notes.length > 0) {
      for (const note of result.notes) console.log(`! ${note}`)
    }
  }
}

function printDiagnosis(result: EvaluationResult) {
  const violations = (result.intentDimensionResults ?? []).filter(
    (d) => !d.honored,
  )
  const recallEvents = result.recallBurdenEvents

  if (violations.length === 0 && recallEvents.length === 0) return

  console.log("Diagnosis (why this agent lost):")
  if (isAggregated(result)) {
    // Rich fields (transcript, dimensions, recallBurdenEvents) come from
    // trial 0; only scores are aggregated. Keep that honest in the report.
    console.log(
      `  (diagnosis from trial 0 of ${result.trials}; scores are averaged but excerpts are illustrative)`,
    )
  }

  for (const dim of violations) {
    console.log(
      `  ✗ ${dim.id} (-${dim.weight}) — ${dim.evidence}`,
    )
    const origin = turnExcerpt(result.transcript, dim.originTurnIndex)
    const pivot = turnExcerpt(result.transcript, dim.pivotTurnIndex)
    const failure = turnExcerpt(result.transcript, dim.failureTurnIndex)
    if (origin) console.log(`       origin   ${origin}`)
    if (pivot) console.log(`       pivot    ${pivot}`)
    if (failure) console.log(`       failure  ${failure}`)
  }

  if (recallEvents.length > 0) {
    // Group by category, show one excerpt per unique category (the first asking turn).
    const seen = new Set<string>()
    const rows: string[] = []
    for (const event of recallEvents) {
      if (seen.has(event.category)) continue
      seen.add(event.category)
      const excerpt =
        turnExcerpt(result.transcript, event.turnIndex) ??
        `(turn unknown): "${truncate(event.message, 110)}"`
      rows.push(`    ${event.category} — ${excerpt}`)
    }
    console.log("  Recall burden:")
    for (const row of rows) console.log(row)
  }
}
