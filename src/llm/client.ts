// Tiny LLM provider abstraction. FidelityBench is not a generic AI library:
// one resolver, one text-generation method, no streaming.

import { generateText } from "ai"
import {
  assertLlmBudgetRemaining,
  recordLlmUsage,
} from "./usage.js"

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }

export type LlmCallOptions = {
  messages: LlmMessage[]
  // Documents the format expected by the caller's parser/prompt. Provider-level
  // JSON enforcement is intentionally not implied by this abstraction.
  expectedFormat?: "text" | "json_object"
  temperature?: number
  maxTokens?: number
  label?: string
}

export type LlmProvider = "anthropic" | "openai" | "bedrock"

export type LlmProviderInfo = {
  provider: LlmProvider
  model: string
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1",
  bedrock: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
}

export const NO_LLM_PROVIDER_MESSAGE =
  "[FidelityBench] LLM agents skipped — set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable LLM baselines."

export const NO_LLM_AGENT_AVAILABLE_MESSAGE =
  "No LLM agent is available because no provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or run --agent rule-memory."

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

function anthropicEnvReady(): boolean {
  return !!readEnv("ANTHROPIC_API_KEY")
}

function openaiEnvReady(): boolean {
  return !!readEnv("OPENAI_API_KEY")
}

function bedrockEnvReady(): boolean {
  return !!(readEnv("BEDROCK_API_KEY") || readEnv("AWS_BEARER_TOKEN_BEDROCK"))
}

function isLlmProvider(value: string): value is LlmProvider {
  return value === "anthropic" || value === "openai" || value === "bedrock"
}

function modelFor(provider: LlmProvider): string {
  return readEnv("FIDELITYBENCH_MODEL") ?? DEFAULT_MODELS[provider]
}

export function detectProvider(): LlmProviderInfo | undefined {
  const override = readEnv("FIDELITYBENCH_PROVIDER")
  if (override) {
    if (!isLlmProvider(override)) {
      throw new Error(
        "Invalid FIDELITYBENCH_PROVIDER. Expected anthropic, openai, or bedrock.",
      )
    }
    return { provider: override, model: modelFor(override) }
  }

  if (anthropicEnvReady()) return { provider: "anthropic", model: modelFor("anthropic") }
  if (openaiEnvReady()) return { provider: "openai", model: modelFor("openai") }
  if (bedrockEnvReady()) return { provider: "bedrock", model: modelFor("bedrock") }
  return undefined
}

export function hasLlmProvider(): boolean {
  return detectProvider() !== undefined
}

export function requireProvider(): LlmProviderInfo {
  const info = detectProvider()
  if (!info) {
    throw new Error(
      "No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.",
    )
  }
  return info
}

export async function callLlm(opts: LlmCallOptions): Promise<string> {
  const info = requireProvider()
  assertLlmBudgetRemaining()
  if (info.provider === "anthropic") return callAnthropic(info.model, opts)
  if (info.provider === "openai") return callOpenAi(info.model, opts)
  return callBedrock(info.model, opts)
}

async function callAnthropic(
  modelId: string,
  opts: LlmCallOptions,
): Promise<string> {
  const { anthropic } = await import("@ai-sdk/anthropic")
  const model = anthropic(modelId)
  const startedAt = new Date()
  const result = await generateText({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    maxOutputTokens: opts.maxTokens,
  })
  recordLlmUsage({
    provider: "anthropic",
    model: modelId,
    label: opts.label,
    usage: result.usage,
    startedAt,
  })
  return result.text
}

async function callOpenAi(modelId: string, opts: LlmCallOptions): Promise<string> {
  const { openai } = await import("@ai-sdk/openai")
  const model = openai(modelId)
  const startedAt = new Date()
  const result = await generateText({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    maxOutputTokens: opts.maxTokens,
  })
  recordLlmUsage({
    provider: "openai",
    model: modelId,
    label: opts.label,
    usage: result.usage,
    startedAt,
  })
  return result.text
}

async function callBedrock(modelId: string, opts: LlmCallOptions): Promise<string> {
  // Bridge BEDROCK_API_KEY → AWS_BEARER_TOKEN_BEDROCK (the env var the SDK
  // reads). This is the same pattern avocado uses.
  if (process.env.BEDROCK_API_KEY && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY
  }
  if (!process.env.AWS_REGION && process.env.BEDROCK_AWS_REGION) {
    process.env.AWS_REGION = process.env.BEDROCK_AWS_REGION
  }
  const { bedrock } = await import("@ai-sdk/amazon-bedrock")
  const model = bedrock(modelId)
  const startedAt = new Date()
  const result = await generateText({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    maxOutputTokens: opts.maxTokens,
  })
  recordLlmUsage({
    provider: "bedrock",
    model: modelId,
    label: opts.label,
    usage: result.usage,
    startedAt,
  })
  return result.text
}
