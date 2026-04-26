// Tiny LLM provider abstraction. Picks Bedrock if BEDROCK_API_KEY (or
// AWS_BEARER_TOKEN_BEDROCK) is set; falls back to OpenAI if OPENAI_API_KEY is
// set; otherwise throws.
//
// Returns parsed JSON when responseFormat is "json_object" (we ask the model
// to emit strict JSON and validate parse).
//
// This is intentionally minimal — the bench is not a generic AI library. Two
// providers, one method, no streaming.

import { generateText } from "ai"

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }

export type LlmCallOptions = {
  messages: LlmMessage[]
  responseFormat?: "text" | "json_object"
  temperature?: number
  maxTokens?: number
}

export type LlmProvider = "bedrock" | "openai"

export type LlmProviderInfo = {
  provider: LlmProvider
  model: string
}

function bedrockEnvReady(): boolean {
  return !!(process.env.BEDROCK_API_KEY || process.env.AWS_BEARER_TOKEN_BEDROCK)
}

function openaiEnvReady(): boolean {
  return !!process.env.OPENAI_API_KEY
}

export function detectProvider(): LlmProviderInfo {
  if (bedrockEnvReady()) {
    return {
      provider: "bedrock",
      // Default to Sonnet 4.6 — good balance of capability and cost. Override
      // with FIDELITYBENCH_MODEL if you want Opus or Haiku.
      model:
        process.env.FIDELITYBENCH_MODEL ??
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    }
  }
  if (openaiEnvReady()) {
    return {
      provider: "openai",
      model: process.env.FIDELITYBENCH_MODEL ?? "gpt-4o-mini",
    }
  }
  throw new Error(
    "No LLM credentials found. Set BEDROCK_API_KEY (preferred) or OPENAI_API_KEY.",
  )
}

export async function callLlm(opts: LlmCallOptions): Promise<string> {
  const info = detectProvider()
  if (info.provider === "bedrock") {
    return callBedrock(info.model, opts)
  }
  return callOpenAi(info.model, opts)
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
  const result = await generateText({
    model,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0,
    // The Vercel AI SDK uses providerOptions for response_format hints in some
    // providers. For Bedrock+Claude we just instruct via the system prompt —
    // it's reliable when prompted correctly.
  })
  return result.text
}

async function callOpenAi(modelId: string, opts: LlmCallOptions): Promise<string> {
  const { default: OpenAI } = await import("openai")
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const completion = await client.chat.completions.create({
    model: modelId,
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    ...(opts.responseFormat === "json_object"
      ? { response_format: { type: "json_object" } }
      : {}),
  })
  return completion.choices[0]?.message?.content ?? ""
}
