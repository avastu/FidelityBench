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

function logAgentInput(input: AgentInput) {
  if (process.env.FIDELITYBENCH_DEBUG) {
    console.log(input)
  }
}

const POST_FINAL_TURN_LIMIT = 8

export async function runScenario(
  agent: Agent,
  bundle: ScenarioBundle,
): Promise<EvaluationResult> {
  await agent.reset?.()

  const { scenario, simulatedUser, judge } = bundle
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
    recallBurdenEvents.push(...simulated.recallBurdenEvents)
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

  return judge({
    agentName: agent.name,
    scenarioId: scenario.id,
    transcript,
    recallBurdenEvents,
    askedRequiredFields,
  })
}
