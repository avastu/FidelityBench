import type { AggregatedResult, EvaluationResult } from "./types.js"

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

export function aggregateTrials(trials: EvaluationResult[]): AggregatedResult {
  if (trials.length === 0) {
    throw new Error("aggregateTrials called with empty trials array")
  }
  const first = trials[0] as EvaluationResult
  const totals = trials.map((t) => t.totalScore)
  const tasks = trials.map((t) => t.taskSuccess)
  const intents = trials.map((t) => t.intentFidelity)
  const recalls = trials.map((t) => t.recallBurden)
  const clars = trials.map((t) => t.clarificationQuality)
  const tools = trials.map((t) => t.toolUseEfficiency)
  return {
    ...first,
    totalScore: Math.round(mean(totals) * 10) / 10,
    taskSuccess: Math.round(mean(tasks) * 10) / 10,
    intentFidelity: Math.round(mean(intents) * 10) / 10,
    recallBurden: Math.round(mean(recalls) * 10) / 10,
    clarificationQuality: Math.round(mean(clars) * 10) / 10,
    toolUseEfficiency: Math.round(mean(tools) * 10) / 10,
    trials: trials.length,
    stddev: {
      totalScore: Math.round(stddev(totals) * 10) / 10,
      taskSuccess: Math.round(stddev(tasks) * 10) / 10,
      intentFidelity: Math.round(stddev(intents) * 10) / 10,
      recallBurden: Math.round(stddev(recalls) * 10) / 10,
      clarificationQuality: Math.round(stddev(clars) * 10) / 10,
      toolUseEfficiency: Math.round(stddev(tools) * 10) / 10,
    },
  }
}
