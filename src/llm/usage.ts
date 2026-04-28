import type { LlmProvider } from "./client.js"

export type LlmUsageRecord = {
  provider: LlmProvider
  model: string
  label: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  startedAt: string
  latencyMs: number
}

type Rates = {
  inputPerMillion: number
  outputPerMillion: number
}

const records: LlmUsageRecord[] = []

function ratesFor(provider: LlmProvider, model: string): Rates | undefined {
  if (provider === "bedrock" && /claude-sonnet-4-5/i.test(model)) {
    const regionalPremium =
      model.startsWith("us.") || model.startsWith("eu.") || model.startsWith("au.")
    return {
      inputPerMillion: regionalPremium ? 3.3 : 3,
      outputPerMillion: regionalPremium ? 16.5 : 15,
    }
  }
  if (provider === "anthropic" && /claude.*sonnet.*4[.-]?5/i.test(model)) {
    return { inputPerMillion: 3, outputPerMillion: 15 }
  }
  if (provider === "openai" && /^gpt-4\.1$/i.test(model)) {
    return { inputPerMillion: 2, outputPerMillion: 8 }
  }
  return undefined
}

function usageNumber(usage: unknown, keys: string[]): number {
  if (typeof usage !== "object" || usage === null) return 0
  const obj = usage as Record<string, unknown>
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return 0
}

export function estimateLlmCostUsd(
  provider: LlmProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = ratesFor(provider, model)
  if (!rates) return 0
  return (
    (inputTokens / 1_000_000) * rates.inputPerMillion +
    (outputTokens / 1_000_000) * rates.outputPerMillion
  )
}

export function getLlmUsageSummary() {
  const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0)
  const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0)
  const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0)
  const estimatedCostUsd = records.reduce(
    (sum, r) => sum + r.estimatedCostUsd,
    0,
  )
  return {
    calls: records.length,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    byLabel: Object.values(
      records.reduce<Record<string, {
        label: string
        calls: number
        inputTokens: number
        outputTokens: number
        estimatedCostUsd: number
      }>>((acc, record) => {
        const entry =
          acc[record.label] ??
          {
            label: record.label,
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
          }
        entry.calls += 1
        entry.inputTokens += record.inputTokens
        entry.outputTokens += record.outputTokens
        entry.estimatedCostUsd += record.estimatedCostUsd
        acc[record.label] = entry
        return acc
      }, {}),
    ).map((entry) => ({
      ...entry,
      estimatedCostUsd: Math.round(entry.estimatedCostUsd * 10000) / 10000,
    })),
    records: records.map((record) => ({ ...record })),
  }
}

export function resetLlmUsage() {
  records.length = 0
}

function rawEstimatedCostUsd(): number {
  return records.reduce((sum, r) => sum + r.estimatedCostUsd, 0)
}

export function assertLlmBudgetRemaining(phase = "before LLM call") {
  const cap = process.env.FIDELITYBENCH_MAX_COST_USD
  if (!cap) return
  const max = Number.parseFloat(cap)
  if (!Number.isFinite(max) || max <= 0) return
  const spent = rawEstimatedCostUsd()
  if (spent >= max) {
    throw new Error(
      `FIDELITYBENCH_MAX_COST_USD exceeded ${phase}: $${spent.toFixed(4)} >= $${max.toFixed(2)}`,
    )
  }
}

export function recordLlmUsage(args: {
  provider: LlmProvider
  model: string
  label: string | undefined
  usage: unknown
  startedAt: Date
}) {
  const inputTokens = usageNumber(args.usage, [
    "inputTokens",
    "promptTokens",
    "input_tokens",
    "prompt_tokens",
  ])
  const outputTokens = usageNumber(args.usage, [
    "outputTokens",
    "completionTokens",
    "output_tokens",
    "completion_tokens",
  ])
  const totalTokens =
    usageNumber(args.usage, ["totalTokens", "total_tokens"]) ||
    inputTokens + outputTokens
  records.push({
    provider: args.provider,
    model: args.model,
    label: args.label ?? "unlabeled",
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: estimateLlmCostUsd(
      args.provider,
      args.model,
      inputTokens,
      outputTokens,
    ),
    startedAt: args.startedAt.toISOString(),
    latencyMs: Date.now() - args.startedAt.getTime(),
  })
  assertLlmBudgetRemaining("after LLM call")
}
