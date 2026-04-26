import type {
  EvaluationResult,
  RecallBurdenCategory,
  ScenarioBundle,
  TranscriptEvent,
} from "./types.js"

const DEFAULT_MAX_TOTAL = 100
const DEFAULT_MAX_INTENT = 35

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

function getKeyBehavior(result: EvaluationResult): string {
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

export function printAggregateSummary(results: EvaluationResult[]) {
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
}

export function printReport(results: EvaluationResult[], bundle?: ScenarioBundle) {
  console.log("FidelityBench v1.0.1")
  const scenarioId = results[0]?.scenarioId
  const maxTotal = bundle?.maxScore ?? DEFAULT_MAX_TOTAL
  const maxIntent = bundle?.maxIntentFidelity ?? DEFAULT_MAX_INTENT
  if (scenarioId) console.log(`Scenario: ${scenarioId}`)
  if (bundle?.probes) console.log(`Probes:   ${bundle.probes}`)
  console.log("")

  const header =
    `${pad("Agent", 22, "start")}` +
    `${pad("Score", 12)}` +
    `${pad("Task", 9)}` +
    `${pad("Intent", 11)}` +
    `${pad("RecallBurden", 16)}` +
    `${pad("Clarification", 16)}` +
    `${pad("Tools", 8)}`
  console.log(header)

  for (const result of results) {
    const row =
      `${pad(result.agentName, 22, "start")}` +
      `${pad(`${result.totalScore}/${maxTotal}`, 12)}` +
      `${pad(`${result.taskSuccess}/30`, 9)}` +
      `${pad(`${result.intentFidelity}/${maxIntent}`, 11)}` +
      `${pad(`${result.recallBurden}/20`, 16)}` +
      `${pad(`${result.clarificationQuality}/10`, 16)}` +
      `${pad(`${result.toolUseEfficiency}/5`, 8)}`
    console.log(row)
  }

  for (const result of results) {
    const recallCategories = uniqueRecallCategories(result)
    console.log("")
    console.log(`── ${result.agentName} ──`)
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

    if (result.notes && result.notes.length > 0) {
      for (const note of result.notes) console.log(`! ${note}`)
    }
  }
}
