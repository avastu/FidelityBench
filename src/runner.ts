import type { Agent } from "./agents/Agent.js"
import { executeToolCall } from "./tools.js"
import type {
  AgentInput,
  EvaluationResult,
  InputType,
  RecallBurdenEvent,
  ScenarioBundle,
  TranscriptEvent,
} from "./types.js"

const LLM_ERROR_PREFIX = "[LLM error:"

function logAgentInput(input: AgentInput) {
  if (process.env.FIDELITYBENCH_DEBUG) {
    console.log(input)
  }
}

// 12 turns lets a frontier LLM recover from a bad first search (e.g. asking
// for an unavailable time). Earlier value of 8 truncated some real LLM runs
// before they could correct course. Override with FIDELITYBENCH_TURN_LIMIT.
const POST_FINAL_TURN_LIMIT = (() => {
  const env = process.env.FIDELITYBENCH_TURN_LIMIT
  const n = env ? parseInt(env, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 12
})()

export async function runScenario(
  agent: Agent,
  bundle: ScenarioBundle,
): Promise<EvaluationResult> {
  await agent.reset?.()

  const { scenario, simulatedUser, judge, asyncJudge } = bundle
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const userId = "eval_user_001"
  const transcript: TranscriptEvent[] = []
  const recallBurdenEvents: RecallBurdenEvent[] = []
  const askedRequiredFields = new Set<string>()

  for (const event of scenario.timeline) {
    transcript.push({
      type: "user",
      timestamp: event.timestamp,
      message: event.message,
    })

    const input: AgentInput = {
      runId,
      scenarioId: scenario.id,
      userId,
      timestamp: event.timestamp,
      inputType: "user",
      message: event.message,
    }
    logAgentInput(input)

    const output = await agent.handleMessage(input)
    transcript.push({
      type: "assistant",
      timestamp: event.timestamp,
      agentName: agent.name,
      message: output.message,
      toolCalls: output.toolCalls,
    })
  }

  let currentTimestamp = scenario.finalTask.timestamp
  let currentMessage = scenario.finalTask.message
  let currentInputType: InputType = "user"

  transcript.push({
    type: "user",
    timestamp: currentTimestamp,
    message: currentMessage,
  })

  for (let turn = 0; turn < POST_FINAL_TURN_LIMIT; turn += 1) {
    const input: AgentInput = {
      runId,
      scenarioId: scenario.id,
      userId,
      timestamp: currentTimestamp,
      inputType: currentInputType,
      message: currentMessage,
    }
    logAgentInput(input)

    const output = await agent.handleMessage(input)
    transcript.push({
      type: "assistant",
      timestamp: currentTimestamp,
      agentName: agent.name,
      message: output.message,
      toolCalls: output.toolCalls,
    })

    if (output.toolCalls && output.toolCalls.length > 0) {
      let lastResultMessage = ""
      for (const toolCall of output.toolCalls) {
        const result = executeToolCall(toolCall)
        transcript.push({
          type: "tool_result",
          timestamp: currentTimestamp,
          result,
        })
        lastResultMessage = JSON.stringify(result, null, 2)
      }
      currentInputType = "tool_result"
      currentMessage = lastResultMessage
      continue
    }

    const simulated = simulatedUser(output.message)
    // Stamp each recall-burden event with the assistant turn that asked.
    // Simulated users don't know the turn index; the runner does. This
    // lets the report quote the responsible turn for each violation.
    const assistantTurnIndex = transcript.length - 1
    for (const event of simulated.recallBurdenEvents) {
      recallBurdenEvents.push({ ...event, turnIndex: assistantTurnIndex })
    }
    for (const field of simulated.askedRequiredFields) {
      askedRequiredFields.add(field)
    }

    if (simulated.shouldRespond && simulated.response) {
      transcript.push({
        type: "user",
        timestamp: currentTimestamp,
        message: simulated.response,
      })
      currentInputType = "user"
      currentMessage = simulated.response
      continue
    }

    break
  }

  const result = judge({
    agentName: agent.name,
    scenarioId: scenario.id,
    transcript,
    recallBurdenEvents,
    askedRequiredFields,
  })

  let augmented = result
  if (asyncJudge) {
    try {
      augmented = await asyncJudge(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const note = `[asyncJudge skipped: ${message.slice(0, 200)}]`
      augmented = {
        ...result,
        notes: [...(result.notes ?? []), note],
      }
    }
  }

  return invalidateLlmErrorResult(augmented)
}

function findLlmError(transcript: TranscriptEvent[]): string | undefined {
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    if (event.message.startsWith(LLM_ERROR_PREFIX)) return event.message
  }
  return undefined
}

function invalidateLlmErrorResult(result: EvaluationResult): EvaluationResult {
  const llmError = findLlmError(result.transcript)
  if (!llmError) return result

  const reason = `INVALID RUN: agent returned an LLM/provider error (${llmError})`
  return {
    ...result,
    totalScore: 0,
    taskSuccess: 0,
    intentFidelity: 0,
    recallBurden: 0,
    clarificationQuality: 0,
    toolUseEfficiency: 0,
    recallBurdenEvents: [],
    selectedRestaurantId: undefined,
    heldReservation: undefined,
    intentDimensionResults: undefined,
    invalidReason: reason,
    notes: result.notes,
  }
}
