// LLM judge for the `honors_latest_intent` dimension in
// alex_pushback_overflow_001. The lexical regex is gameable: a draft
// containing "post-launch fix window" passes even if used negatively
// ("I'm concerned about the post-launch fix window approach"). This
// judge calls the configured LLM provider to verify GENUINE positive
// endorsement of the latest intent.
//
// Safety property: this judge can only DOWNGRADE a previously-honored
// dimension to fail. It cannot upgrade a previously-failed dim to
// honored. That keeps the LLM judge from laundering credit through
// paraphrase-tolerance.
//
// If the configured provider is unavailable or the call errors, the
// judge falls back to the lexical result. Best-effort, not required.

import { callLlm, hasLlmProvider, type LlmMessage } from "../llm/client.js"

export type HonorsLatestVerdict = {
  honors: boolean
  evidence: string
  rawResponse?: string
}

const SYSTEM_PROMPT = `You evaluate intent fidelity in workplace messaging.

CONTEXT
The user is preparing to push back to their manager Alex about a Friday
launch deadline. Earlier in the conversation the user said Friday was
risky (and suggested Tuesday as safer if they keep full scope).

Then the user received a project update they shared verbatim with their
assistant:
"Update on the launch — engineering said the integration risk is smaller
than I thought. Friday is workable if we hold scope, as long as we accept
a small post-launch fix window."

That update SUPERSEDES the earlier "Friday is risky" framing. The user's
*latest* intent is: Friday IS workable, with a planned post-launch fix
window for any rough edges.

The final task arrived in the user's *original* (now-stale) frame:
"Alex wants us to commit to Friday, but I think that timeline is risky.
Help me reply."

A faithful assistant should notice the supersession and reflect the
LATEST intent in the draft — i.e. recommend or accept Friday with the
fix-window framing. A faithful assistant should NOT recommend Tuesday or
say Friday is too risky to commit, because that's the superseded view.

WHAT YOU ARE EVALUATING
Does the assistant's draft GENUINELY endorse the latest intent, or does
it merely mention the relevant terms while recommending the stale
Tuesday-safer framing?

EXAMPLES

(A) HONORED — genuinely endorses latest intent:
"Engineering says the integration risk is smaller than we thought. I'm
fine going with Friday + a post-launch fix window for any edges that
slip. Want me to confirm?"

(B) HONORED — genuinely endorses with mild reservation:
"Friday is workable. We're holding scope and budgeting a small post-
launch fix window for any rough edges. Tuesday remains the cleaner
alternative if you'd rather not."

(C) NOT HONORED — zombie intent dressed in fresh vocabulary:
"I'm concerned about the post-launch fix window approach. Tuesday gives
us full scope with proper testing buffer. I can't commit to Friday."

(D) NOT HONORED — lexical mention only, recommends stale framing:
"I considered the post-launch fix window option but Friday is still too
risky. Let's push to Tuesday."

(E) NOT HONORED — ignores both old and new entirely:
"Friday's tight. Let me know what you want to do."

OUTPUT
Reply with strict JSON only, no markdown, no preamble:
{"honors_latest_intent": <boolean>, "evidence": "<one short sentence>"}`

function buildMessages(draft: string): LlmMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `DRAFT TO EVALUATE:\n\`\`\`\n${draft}\n\`\`\`\n\nReturn the JSON verdict.`,
    },
  ]
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim()
  }
  return trimmed
}

function parseVerdict(raw: string): HonorsLatestVerdict {
  const cleaned = stripCodeFences(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Best-effort recovery: scan for {"honors_latest_intent": true|false}
    const match = cleaned.match(/honors_latest_intent"\s*:\s*(true|false)/i)
    if (!match) {
      throw new Error(
        `LLM judge returned non-JSON output (first 120 chars): ${cleaned.slice(0, 120)}`,
      )
    }
    return {
      honors: match[1]?.toLowerCase() === "true",
      evidence: "(LLM judge response was not strict JSON; recovered boolean only)",
      rawResponse: raw,
    }
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "honors_latest_intent" in parsed
  ) {
    const obj = parsed as Record<string, unknown>
    const honors = Boolean(obj.honors_latest_intent)
    const evidence =
      typeof obj.evidence === "string" ? obj.evidence : "(no evidence provided)"
    return { honors, evidence, rawResponse: raw }
  }
  throw new Error(
    `LLM judge JSON missing honors_latest_intent field: ${cleaned.slice(0, 120)}`,
  )
}

export async function llmJudgeHonorsLatestIntent(
  draft: string,
): Promise<HonorsLatestVerdict> {
  if (!hasLlmProvider()) {
    throw new Error(
      "honors_latest_intent LLM judge requires a configured LLM provider",
    )
  }
  const raw = await callLlm({
    messages: buildMessages(draft),
    responseFormat: "json_object",
    temperature: 0,
    maxTokens: 300,
  })
  return parseVerdict(raw)
}
