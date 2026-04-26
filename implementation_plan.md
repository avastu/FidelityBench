FidelityBench v0 — Implementation Spec

0. One-sentence goal

Build a local eval system that tests whether an AI product can faithfully execute a user’s accumulated intent over time without making the user repeat context it already provided.

⸻

1. Product thesis

AI products increasingly claim to “know,” “support,” “personalize,” “coach,” or “assist” humans. FidelityBench evaluates whether those claims are behaviorally true.

A system passes FidelityBench when it can:

1. Preserve user preferences, constraints, decisions, boundaries, and open loops.
2. Apply that accumulated intent to a later task.
3. Ask only for genuinely missing information.
4. Use tools correctly.
5. Avoid making the user carry the memory.

The core construct is:

Intention Fidelity

Intention fidelity is the degree to which an AI system’s behavior remains faithful to the user’s accumulated intent across time.

The core metric is:

Recall Burden

Recall burden is the amount of previously established context the assistant asks the user to repeat.

⸻

2. v0 scope

Implement one complete local benchmark scenario:

Scenario: Plan the team offsite dinner.
Domain: human-support / executive-assistant style task.
Task type: logistical fidelity.

The scenario tests whether the assistant can remember and apply:

- preferred dinner time
- attendee dietary needs
- prior cuisine decision
- budget
- location
- genuinely missing party size

The assistant receives only the current message at each turn.

It does not receive the prior transcript.

If it succeeds, that success must come from its own memory/state.

⸻

3. Non-goals for v0

Do not build:

- hosted platform
- web UI
- leaderboard
- database
- auth
- real restaurant APIs
- real calendar APIs
- embeddings
- graph visualization
- LLM judge
- multi-domain benchmark
- many scenarios

v0 should be a local CLI benchmark that can run end-to-end.

⸻

4. Required deliverable

By the end, this should work:

npm install
npm run bench

Expected output:

FidelityBench v0
Scenario: dinner_offsite_001
Agent                  Score   Task   Intent   RecallBurden   Clarification   Tools
StatelessAgent          28     10/30   8/35      0/20           3/10           0/5
RuleMemoryAgent         96     30/30  35/35     20/20          6/10           5/5
StatelessLLMAgent       ??     ...
FileMemoryLLMAgent      ??     ...
Key failure modes:
- StatelessAgent asked the user to repeat known cuisine, budget, time, location, and dietary constraints.
- RuleMemoryAgent asked only for missing party size and selected Bella Tavola.

The exact LLM scores may vary, but the system must generate measurable results.

⸻

5. Directory structure

fidelitybench/
  package.json
  tsconfig.json
  README.md
  .env.example
  src/
    index.ts
    types.ts
    scenario.ts
    runner.ts
    tools.ts
    simulatedUser.ts
    evaluator.ts
    report.ts
    agents/
      Agent.ts
      StatelessAgent.ts
      RuleMemoryAgent.ts
      StatelessLLMAgent.ts
      FileMemoryLLMAgent.ts
    memory/
      fileMemory.ts
  scenarios/
    dinner_offsite_001.ts
    schedule_alice_001.todo.md
    board_update_privacy_001.todo.md
    alex_pushback_001.todo.md
  results/
    sample-run.json

⸻

6. Core protocol

6.1 Agent receives only current message

Every turn sent to the agent has this shape:

export type AgentInput = {
  runId: string
  scenarioId: string
  userId: string
  timestamp: string
  inputType: "user" | "tool_result"
  message: string
}

Important:

The input must not include prior transcript.
The input must not include hidden scenario state.
The input must not include evaluator rubric.

The agent can maintain its own internal memory.

6.2 Agent returns message plus optional tool calls

export type AgentOutput = {
  message: string
  toolCalls?: ToolCall[]
}

Tool calls are returned as structured JSON.

⸻

7. Types

Create src/types.ts.

export type InputType = "user" | "tool_result"
export type AgentInput = {
  runId: string
  scenarioId: string
  userId: string
  timestamp: string
  inputType: InputType
  message: string
}
export type RestaurantSearchArgs = {
  location?: string
  date?: string
  time?: string
  partySize?: number
}
export type HoldReservationArgs = {
  restaurantId: string
  date: string
  time: string
  partySize: number
}
export type ToolCall =
  | {
      tool: "restaurants.search"
      args: RestaurantSearchArgs
    }
  | {
      tool: "restaurants.holdReservation"
      args: HoldReservationArgs
    }
export type AgentOutput = {
  message: string
  toolCalls?: ToolCall[]
}
export type Restaurant = {
  id: string
  name: string
  cuisine: string
  neighborhood: string
  priceEstimatePerPerson: number
  availableTimes: string[]
  description: string
  menuHighlights: string[]
  dietaryNotes: string
}
export type ToolResult = {
  tool: ToolCall["tool"]
  args: unknown
  result: unknown
}
export type TimelineEvent = {
  timestamp: string
  message: string
}
export type Scenario = {
  id: string
  title: string
  timeline: TimelineEvent[]
  finalTask: TimelineEvent
}
export type TranscriptEvent =
  | {
      type: "user"
      timestamp: string
      message: string
    }
  | {
      type: "assistant"
      timestamp: string
      agentName: string
      message: string
      toolCalls?: ToolCall[]
    }
  | {
      type: "tool_result"
      timestamp: string
      result: ToolResult
    }
export type RecallBurdenEvent = {
  category: "cuisine" | "budget" | "dietary" | "location" | "time"
  message: string
}
export type EvaluationResult = {
  agentName: string
  scenarioId: string
  totalScore: number
  taskSuccess: number
  intentFidelity: number
  recallBurden: number
  clarificationQuality: number
  toolUseEfficiency: number
  recallBurdenEvents: RecallBurdenEvent[]
  selectedRestaurantId?: string
  heldReservation?: HoldReservationArgs
  transcript: TranscriptEvent[]
}

⸻

8. Scenario

Create src/scenario.ts or scenarios/dinner_offsite_001.ts.

import { Scenario } from "../src/types"
export const dinnerOffsiteScenario: Scenario = {
  id: "dinner_offsite_001",
  title: "Plan the team offsite dinner",
  timeline: [
    {
      timestamp: "2026-05-01T09:00:00-07:00",
      message:
        "For future work dinners, I prefer not to start before 7pm. I always feel rushed before then.",
    },
    {
      timestamp: "2026-05-03T11:00:00-07:00",
      message:
        "Priya is vegetarian, so make sure team meals have real vegetarian options, not just salad.",
    },
    {
      timestamp: "2026-05-04T14:30:00-07:00",
      message:
        "Miguel avoids shellfish. Not allergic, but seafood-heavy places aren't great when he's joining.",
    },
    {
      timestamp: "2026-05-08T16:00:00-07:00",
      message: "For next week's offsite, the team chose Italian over sushi.",
    },
    {
      timestamp: "2026-05-09T10:00:00-07:00",
      message: "Let's keep dinner around $80/person if possible.",
    },
    {
      timestamp: "2026-05-10T12:00:00-07:00",
      message: "We're staying near Union Square for the offsite.",
    },
  ],
  finalTask: {
    timestamp: "2026-05-14T10:00:00-07:00",
    message: "Can you plan the team offsite dinner for Wednesday, May 20?",
  },
}

⸻

9. Restaurant tools

Create src/tools.ts.

9.1 Restaurant data

The restaurant search tool must return realistic world state, not evaluator labels.

Do not include fields like:

avoidSeafoodHeavy
vegetarianFriendly
matchesUserPreferences

Use this data:

import {
  Restaurant,
  RestaurantSearchArgs,
  HoldReservationArgs,
  ToolCall,
  ToolResult,
} from "./types"
export const RESTAURANTS: Restaurant[] = [
  {
    id: "rest_001",
    name: "Sakura Omakase",
    cuisine: "Japanese",
    neighborhood: "Union Square",
    priceEstimatePerPerson: 95,
    availableTimes: ["18:00", "19:30"],
    description: "Seafood-forward omakase counter with limited substitutions.",
    menuHighlights: ["uni", "toro", "shellfish tasting", "miso soup"],
    dietaryNotes: "Limited vegetarian options.",
  },
  {
    id: "rest_002",
    name: "Bella Tavola",
    cuisine: "Italian",
    neighborhood: "Union Square",
    priceEstimatePerPerson: 72,
    availableTimes: ["18:30", "19:30", "20:00"],
    description:
      "Warm Italian trattoria with house pastas, seasonal vegetables, and private dining.",
    menuHighlights: [
      "mushroom pappardelle",
      "eggplant parmesan",
      "branzino",
      "tiramisu",
    ],
    dietaryNotes: "Several vegetarian mains available.",
  },
  {
    id: "rest_003",
    name: "Harbor & Pearl",
    cuisine: "Seafood",
    neighborhood: "Embarcadero",
    priceEstimatePerPerson: 88,
    availableTimes: ["19:00", "20:15"],
    description:
      "Seafood restaurant focused on oysters, crab, shellfish towers, and coastal wines.",
    menuHighlights: [
      "oysters",
      "lobster roll",
      "shellfish platter",
      "clam linguine",
    ],
    dietaryNotes: "Vegetarian sides available.",
  },
  {
    id: "rest_004",
    name: "North Beach Pasta House",
    cuisine: "Italian",
    neighborhood: "North Beach",
    priceEstimatePerPerson: 68,
    availableTimes: ["19:15", "20:00"],
    description:
      "Casual Italian spot with pastas, salads, and several vegetarian options.",
    menuHighlights: ["cacio e pepe", "margherita pizza", "vegetable lasagna"],
    dietaryNotes: "Good vegetarian options.",
  },
]

9.2 Search tool

Important:

restaurants.search must always return all restaurants.
It may log the args.
It should not filter by cuisine.
It should not filter by dietary needs.
The agent must reason over the returned options.
export function searchRestaurants(args: RestaurantSearchArgs): Restaurant[] {
  // v0 intentionally returns all options.
  // The agent must inspect the returned world state and choose.
  return RESTAURANTS
}

9.3 Hold reservation tool

export function holdReservation(args: HoldReservationArgs) {
  const restaurant = RESTAURANTS.find((r) => r.id === args.restaurantId)
  if (!restaurant) {
    return {
      success: false,
      message: `Restaurant ${args.restaurantId} not found.`,
    }
  }
  if (!restaurant.availableTimes.includes(args.time)) {
    return {
      success: false,
      message: `${restaurant.name} is not available at ${args.time}.`,
    }
  }
  return {
    success: true,
    reservationId: `res_${args.restaurantId}_${args.time.replace(":", "")}`,
    message: `Held reservation at ${restaurant.name} for ${args.partySize} people at ${args.time}.`,
  }
}

9.4 Tool executor

export function executeToolCall(toolCall: ToolCall): ToolResult {
  if (toolCall.tool === "restaurants.search") {
    return {
      tool: toolCall.tool,
      args: toolCall.args,
      result: searchRestaurants(toolCall.args),
    }
  }
  if (toolCall.tool === "restaurants.holdReservation") {
    return {
      tool: toolCall.tool,
      args: toolCall.args,
      result: holdReservation(toolCall.args),
    }
  }
  throw new Error(`Unknown tool call: ${(toolCall as any).tool}`)
}

⸻

10. Simulated user

Create src/simulatedUser.ts.

The simulated user only responds after the final task if the assistant asks a clarification question.

Its job is to:

1. Answer genuinely missing questions.
2. Repeat known context if the assistant asks for it.
3. Log recall burden events.

10.1 Recall burden patterns

Use coarse regex detection.

import { RecallBurdenEvent } from "./types"
export type SimulatedUserResult = {
  shouldRespond: boolean
  response?: string
  recallBurdenEvents: RecallBurdenEvent[]
  askedPartySize: boolean
}
const PATTERNS = {
  cuisine: [
    /what (cuisine|kind of food|type of food)/i,
    /any preference.*(cuisine|food)/i,
    /what.*restaurant.*type/i,
    /what.*food.*want/i,
  ],
  budget: [
    /what.*budget/i,
    /price range/i,
    /how much.*spend/i,
    /cost.*limit/i,
    /budget.*for/i,
  ],
  dietary: [
    /dietary/i,
    /allerg/i,
    /vegetarian/i,
    /food restrictions/i,
    /any restrictions/i,
  ],
  location: [
    /where.*(look|search|book|reserve)/i,
    /what.*neighborhood/i,
    /which area/i,
    /location/i,
    /near where/i,
  ],
  time: [
    /what time/i,
    /when.*dinner/i,
    /preferred time/i,
    /what.*start/i,
    /what time.*book/i,
  ],
}
const PARTY_SIZE_PATTERNS = [
  /party size/i,
  /how many people/i,
  /how many.*attending/i,
  /number of people/i,
  /for how many/i,
  /how many guests/i,
]

10.2 Classifier

function matchAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message))
}
export function simulateUserResponse(
  assistantMessage: string
): SimulatedUserResult {
  const recallBurdenEvents: RecallBurdenEvent[] = []
  for (const [category, patterns] of Object.entries(PATTERNS)) {
    if (matchAny(assistantMessage, patterns)) {
      recallBurdenEvents.push({
        category: category as RecallBurdenEvent["category"],
        message: assistantMessage,
      })
    }
  }
  const askedPartySize = matchAny(assistantMessage, PARTY_SIZE_PATTERNS)
  if (askedPartySize) {
    return {
      shouldRespond: true,
      response: "8 people.",
      recallBurdenEvents,
      askedPartySize: true,
    }
  }
  if (recallBurdenEvents.length > 0) {
    const responses: string[] = []
    for (const event of recallBurdenEvents) {
      if (event.category === "cuisine") {
        responses.push("We decided Italian over sushi last week.")
      }
      if (event.category === "budget") {
        responses.push("Around $80/person.")
      }
      if (event.category === "dietary") {
        responses.push("Priya is vegetarian, and Miguel avoids shellfish.")
      }
      if (event.category === "location") {
        responses.push("We're staying near Union Square.")
      }
      if (event.category === "time") {
        responses.push("After 7pm — I feel rushed before then.")
      }
    }
    return {
      shouldRespond: true,
      response: responses.join(" "),
      recallBurdenEvents,
      askedPartySize: false,
    }
  }
  // If the assistant did not ask a recognizable question, do not respond.
  return {
    shouldRespond: false,
    recallBurdenEvents,
    askedPartySize: false,
  }
}

10.3 Known limitation

README must state:

Recall burden detection in v0 is regex-based. It catches common explicit clarification questions but will miss paraphrases and may produce false positives.

⸻

11. Agent interface

Create src/agents/Agent.ts.

import { AgentInput, AgentOutput } from "../types"
export interface Agent {
  name: string
  handleMessage(input: AgentInput): Promise<AgentOutput>
  reset?(): Promise<void> | void
}

⸻

12. Baseline agents

12.1 StatelessAgent

Create src/agents/StatelessAgent.ts.

This agent intentionally forgets everything.

import { Agent } from "./Agent"
import { AgentInput, AgentOutput } from "../types"
export class StatelessAgent implements Agent {
  name = "StatelessAgent"
  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (/plan.*dinner|offsite dinner/i.test(input.message)) {
      return {
        message:
          "Sure — what cuisine, budget, location, time, dietary restrictions, and party size should I keep in mind?",
      }
    }
    if (/8 people/i.test(input.message)) {
      return {
        message:
          "Thanks. I can look for dinner options once I know cuisine, budget, location, and dietary restrictions.",
      }
    }
    return {
      message: "Got it.",
    }
  }
}

Expected:

High recall burden.
Low/no tool success.

12.2 RuleMemoryAgent

Create src/agents/RuleMemoryAgent.ts.

This is a reference baseline with simple structured memory.

import { Agent } from "./Agent"
import {
  AgentInput,
  AgentOutput,
  ToolCall,
  ToolResult,
  Restaurant,
} from "../types"
type MemoryState = {
  preferredDinnerStartTime?: string
  dietaryNotes: string[]
  cuisineDecision?: string
  budgetPerPerson?: number
  location?: string
  partySize?: number
  finalTaskActive?: boolean
  searched?: boolean
}
export class RuleMemoryAgent implements Agent {
  name = "RuleMemoryAgent"
  private memory: MemoryState = {
    dietaryNotes: [],
  }
  reset() {
    this.memory = {
      dietaryNotes: [],
    }
  }
  async handleMessage(input: AgentInput): Promise<AgentOutput> {
    if (input.inputType === "tool_result") {
      return this.handleToolResult(input.message)
    }
    this.ingestUserMessage(input.message)
    if (/plan.*offsite dinner|team offsite dinner/i.test(input.message)) {
      this.memory.finalTaskActive = true
      if (!this.memory.partySize) {
        return {
          message:
            "I’ll look for Italian options near Union Square after 7pm, around $80/person, with real vegetarian options and not seafood-heavy. What party size should I use?",
        }
      }
      return this.searchRestaurants()
    }
    if (this.memory.finalTaskActive && /8 people/i.test(input.message)) {
      this.memory.partySize = 8
      return this.searchRestaurants()
    }
    return {
      message: "Got it.",
    }
  }
  private ingestUserMessage(message: string) {
    if (/not to start before 7pm|after 7pm/i.test(message)) {
      this.memory.preferredDinnerStartTime = "19:00"
    }
    if (/Priya.*vegetarian/i.test(message)) {
      this.memory.dietaryNotes.push(
        "Priya is vegetarian and needs real vegetarian options."
      )
    }
    if (/Miguel.*shellfish|seafood-heavy/i.test(message)) {
      this.memory.dietaryNotes.push(
        "Miguel avoids shellfish; avoid seafood-heavy restaurants."
      )
    }
    if (/Italian over sushi|chose Italian/i.test(message)) {
      this.memory.cuisineDecision = "Italian"
    }
    if (/\$80\/person|80\/person|80 per person/i.test(message)) {
      this.memory.budgetPerPerson = 80
    }
    if (/Union Square/i.test(message)) {
      this.memory.location = "Union Square"
    }
    if (/8 people/i.test(message)) {
      this.memory.partySize = 8
    }
  }
  private searchRestaurants(): AgentOutput {
    const toolCalls: ToolCall[] = [
      {
        tool: "restaurants.search",
        args: {
          location: this.memory.location,
          date: "2026-05-20",
          time: "19:30",
          partySize: this.memory.partySize,
        },
      },
    ]
    return {
      message: "I’ll search dinner options now.",
      toolCalls,
    }
  }
  private handleToolResult(toolResultMessage: string): AgentOutput {
    let restaurants: Restaurant[] = []
    try {
      const parsed = JSON.parse(toolResultMessage) as ToolResult
      restaurants = parsed.result as Restaurant[]
    } catch {
      return {
        message: "I had trouble reading the restaurant results.",
      }
    }
    const bella = restaurants.find((r) => r.id === "rest_002")
    if (!bella || !this.memory.partySize) {
      return {
        message: "I could not find a suitable reservation to hold.",
      }
    }
    return {
      message:
        "Bella Tavola looks like the best fit: it’s Italian, near Union Square, around $72/person, has several vegetarian mains, and is not seafood-focused. I’ll place a hold for 8 people at 7:30pm.",
      toolCalls: [
        {
          tool: "restaurants.holdReservation",
          args: {
            restaurantId: "rest_002",
            date: "2026-05-20",
            time: "19:30",
            partySize: this.memory.partySize,
          },
        },
      ],
    }
  }
}

Expected:

High score.
Low recall burden.
Correct restaurant.

12.3 StatelessLLMAgent

Create src/agents/StatelessLLMAgent.ts.

This agent uses a real LLM but has no memory.

Environment variables:

OPENAI_API_KEY=
FIDELITYBENCH_MODEL=gpt-5.5

Use whichever SDK is easiest. If LLM integration is too slow overnight, stub it, but the spec should support it.

Prompt:

You are an executive assistant.
You only see the current user message. Respond naturally and helpfully.
If you need information to complete a task, ask the user.
Return strict JSON with this shape:
{
  "message": string,
  "toolCalls": array
}

Expected:

Likely high recall burden on final task.

12.4 FileMemoryLLMAgent

Create src/agents/FileMemoryLLMAgent.ts.

This agent uses a real LLM plus a simple persistent memory file.

Memory path:

.memory/user_001.md

Ingest/update memory

On every user message, call LLM or simple extractor to update the memory file.

Prompt:

You maintain memory for an executive assistant.
Update the memory based on the new user message.
Keep only information that may matter later:
- stable preferences
- constraints
- decisions
- people and their relevant needs/preferences
- locations
- budgets
- open loops
- privacy/boundary notes
Do not store irrelevant chatter.
Existing memory:
{{memory}}
New user message:
{{message}}
Return updated memory as concise markdown.

Respond

At response time, call LLM with:

You are an executive assistant.
You receive only the current user message and your saved memory.
Use memory to avoid making the user repeat known information.
Ask clarifying questions only for genuinely missing information.
If tool use is appropriate, return tool calls.
Saved memory:
{{memory}}
Current input type:
{{inputType}}
Current message:
{{message}}
Available tools:
1. restaurants.search(args: { location?, date?, time?, partySize? })
2. restaurants.holdReservation(args: { restaurantId, date, time, partySize })
Return strict JSON:
{
  "message": string,
  "toolCalls": [
    {
      "tool": "restaurants.search" | "restaurants.holdReservation",
      "args": object
    }
  ]
}

For tool_result, include the tool result in the current message and ask the model to choose.

Expected:

Lower recall burden than StatelessLLMAgent.
Possibly imperfect tool use.
Interesting empirical behavior.

⸻

13. Runner

Create src/runner.ts.

The runner must:

1. Reset agent.
2. Send timeline messages one by one.
3. Send final task.
4. Handle assistant responses.
5. If assistant asks a clarification question, simulated user responds.
6. If assistant returns tool calls, execute them.
7. Send tool results back as tool_result messages.
8. Continue for up to 5 post-final turns.
9. Evaluate.

Pseudo-code:

import { Agent } from "./agents/Agent"
import { Scenario, TranscriptEvent, ToolResult } from "./types"
import { executeToolCall } from "./tools"
import { simulateUserResponse } from "./simulatedUser"
import { evaluateRun } from "./evaluator"
export async function runScenario(agent: Agent, scenario: Scenario) {
  await agent.reset?.()
  const runId = `run_${Date.now()}`
  const userId = "eval_user_001"
  const transcript: TranscriptEvent[] = []
  let allRecallBurdenEvents = []
  let askedPartySize = false
  for (const event of scenario.timeline) {
    transcript.push({
      type: "user",
      timestamp: event.timestamp,
      message: event.message,
    })
    const output = await agent.handleMessage({
      runId,
      scenarioId: scenario.id,
      userId,
      timestamp: event.timestamp,
      inputType: "user",
      message: event.message,
    })
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
  let currentInputType: "user" | "tool_result" = "user"
  transcript.push({
    type: "user",
    timestamp: currentTimestamp,
    message: currentMessage,
  })
  for (let turn = 0; turn < 5; turn++) {
    const output = await agent.handleMessage({
      runId,
      scenarioId: scenario.id,
      userId,
      timestamp: currentTimestamp,
      inputType: currentInputType,
      message: currentMessage,
    })
    transcript.push({
      type: "assistant",
      timestamp: currentTimestamp,
      agentName: agent.name,
      message: output.message,
      toolCalls: output.toolCalls,
    })
    if (output.toolCalls && output.toolCalls.length > 0) {
      for (const toolCall of output.toolCalls) {
        const result = executeToolCall(toolCall)
        transcript.push({
          type: "tool_result",
          timestamp: currentTimestamp,
          result,
        })
        currentInputType = "tool_result"
        currentMessage = JSON.stringify(result, null, 2)
      }
      continue
    }
    const simulated = simulateUserResponse(output.message)
    allRecallBurdenEvents.push(...simulated.recallBurdenEvents)
    askedPartySize = askedPartySize || simulated.askedPartySize
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
  return evaluateRun({
    agentName: agent.name,
    scenarioId: scenario.id,
    transcript,
    recallBurdenEvents: allRecallBurdenEvents,
    askedPartySize,
  })
}

⸻

14. Evaluator

Create src/evaluator.ts.

14.1 Scoring summary

Total: 100.

Task Success:          30
Intent Fidelity:       35
Recall Burden:         20
Clarification Quality: 10
Tool Use Efficiency:    5

14.2 Task Success — 30

+30 reservation held for Bella Tavola at 19:30 or 20:00
+22 reservation held for North Beach Pasta House with explanation
+12 any plausible restaurant recommendation or hold
+0 no concrete option

Implementation:

function getHeldReservation(transcript: TranscriptEvent[]) {
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.holdReservation") {
        return call.args
      }
    }
  }
  return undefined
}

14.3 Intent Fidelity — 35

Award:

+7 honors Italian-over-sushi
+7 after 7pm
+7 around/under $80/person
+7 near Union Square or explains location tradeoff
+7 accounts for vegetarian and avoids seafood/shellfish-heavy choice

This can be evaluated mostly from the held reservation and final assistant messages.

Rules:

Italian:
- +7 if selected rest_002 or rest_004
- or assistant final message mentions Italian
After 7pm:
- +7 if held reservation time >= 19:00
Budget:
- +7 if selected restaurant price <= 80
- +4 if selected <= 90 and explicitly flags tradeoff
Location:
- +7 if selected rest_002
- +5 if selected rest_004 and explains location tradeoff
Dietary/seafood:
- +7 if selected rest_002 or rest_004
- 0 if selected rest_001 or rest_003

14.4 Recall Burden — 20

Start at 20.

Subtract 5 per known-context recall burden category.

Minimum 0.

const uniqueRecallCategories = new Set(
  recallBurdenEvents.map((event) => event.category)
)
const recallBurden = Math.max(0, 20 - uniqueRecallCategories.size * 5)

14.5 Clarification Quality — 10

+10 asks only for party size / genuinely missing information
+6 asks for party size plus one known-context category
+3 asks for party size plus multiple known-context categories
+4 proceeds with reasonable assumption and states it
+0 neither asks nor handles party size

Implementation:

function scoreClarificationQuality({
  askedPartySize,
  recallBurdenCategoryCount,
  heldReservation,
}: {
  askedPartySize: boolean
  recallBurdenCategoryCount: number
  heldReservation?: HoldReservationArgs
}) {
  if (askedPartySize && recallBurdenCategoryCount === 0) return 10
  if (askedPartySize && recallBurdenCategoryCount === 1) return 6
  if (askedPartySize && recallBurdenCategoryCount > 1) return 3
  if (!askedPartySize && heldReservation) return 4
  return 0
}

14.6 Tool Use Efficiency — 5

+5 uses search then holdReservation
+3 uses search but no hold
+0 no tool use

Implementation:

function scoreToolUse(transcript: TranscriptEvent[]) {
  let searched = false
  let held = false
  for (const event of transcript) {
    if (event.type !== "assistant") continue
    for (const call of event.toolCalls ?? []) {
      if (call.tool === "restaurants.search") searched = true
      if (call.tool === "restaurants.holdReservation") held = true
    }
  }
  if (searched && held) return 5
  if (searched) return 3
  return 0
}

⸻

15. Success metrics

These are the criteria the implementation must demonstrably satisfy.

15.1 Protocol success

The runner must prove the current-message-only constraint.

Success condition:

Each AgentInput contains only:
- runId
- scenarioId
- userId
- timestamp
- inputType
- current message

No transcript is passed.

Add a debug mode that logs every AgentInput.

Expected:

No prior messages appear in AgentInput unless the agent itself stored them.

15.2 Tool protocol success

The runner must execute tool calls and return results.

Success condition:

If an agent calls restaurants.search, the next agent input has inputType = "tool_result" and contains the search result.

Expected transcript includes:

assistant → restaurants.search
tool_result → restaurant list
assistant → restaurants.holdReservation
tool_result → reservation result

15.3 Recall burden success

The eval must detect known-context questions.

Test input:

“What cuisine, budget, location, time, and dietary restrictions should I keep in mind?”

Expected:

Recall burden categories:
- cuisine
- budget
- location
- time
- dietary
Recall Burden score: 0/20

Test input:

“What party size should I use?”

Expected:

Recall burden categories: none
Clarification Quality: 10/10

15.4 StatelessAgent expected result

Run:

npm run bench -- --agent stateless

Expected:

Total score <= 40
Recall Burden <= 5/20
No successful Bella Tavola reservation

This proves the benchmark catches amnesia.

15.5 RuleMemoryAgent expected result

Run:

npm run bench -- --agent rule-memory

Expected:

Total score >= 85
Recall Burden >= 15/20
Task Success = 30/30
Selected restaurant = rest_002
Held reservation time >= 19:00

This proves the benchmark rewards fidelity.

15.6 LLM baseline success

If LLM API is configured:

Run:

npm run bench -- --agent stateless-llm
npm run bench -- --agent file-memory-llm

Expected:

Both runs complete.
Both produce parseable AgentOutput JSON.
FileMemoryLLMAgent has lower or equal recall burden than StatelessLLMAgent in most runs.

Do not require exact scores because LLM behavior may vary.

15.7 Report success

npm run bench must print:

- total score
- submetric scores
- recall burden events
- selected restaurant
- held reservation
- tool calls

It must also save:

results/latest-run.json

⸻

16. CLI entrypoint

Create src/index.ts.

import { dinnerOffsiteScenario } from "../scenarios/dinner_offsite_001"
import { runScenario } from "./runner"
import { printReport } from "./report"
import { StatelessAgent } from "./agents/StatelessAgent"
import { RuleMemoryAgent } from "./agents/RuleMemoryAgent"
import { StatelessLLMAgent } from "./agents/StatelessLLMAgent"
import { FileMemoryLLMAgent } from "./agents/FileMemoryLLMAgent"
import fs from "fs"
async function main() {
  const agents = [
    new StatelessAgent(),
    new RuleMemoryAgent(),
  ]
  if (process.env.OPENAI_API_KEY) {
    agents.push(new StatelessLLMAgent())
    agents.push(new FileMemoryLLMAgent())
  }
  const results = []
  for (const agent of agents) {
    const result = await runScenario(agent, dinnerOffsiteScenario)
    results.push(result)
  }
  printReport(results)
  fs.mkdirSync("results", { recursive: true })
  fs.writeFileSync(
    "results/latest-run.json",
    JSON.stringify(results, null, 2)
  )
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})

⸻

17. README requirements

The README must include these sections.

17.1 Opening

# FidelityBench
FidelityBench is an eval system for AI products that claim to understand and support humans.
It tests whether an AI system can faithfully execute a user’s accumulated intent over time.
The v0 benchmark simulates a user texting an assistant across multiple turns. The assistant only receives the current message at each turn, so any prior context must come from its own memory.

17.2 Why this is different

## Why this is different from long-memory QA
Long-memory QA benchmarks ask: “What did the user say before?”
Tool-use benchmarks ask: “Can the agent complete this task?”
FidelityBench asks: “Can the agent take an action that faithfully executes accumulated user intent without forcing the user to repeat themselves?”

17.3 Metrics

## Metrics
### Intention Fidelity
Does the assistant’s action preserve the user’s accumulated preferences, constraints, decisions, and boundaries?
### Recall Burden
How much previously established context does the assistant ask the user to repeat?
### Task Success
Did the assistant complete the requested task?
### Clarification Quality
Did the assistant ask only for genuinely missing information?
### Tool Use Efficiency
Did the assistant use the available tools appropriately?

17.4 v0 limitation

## v0 Limitations
- One scenario only.
- Recall burden detection is regex-based.
- The restaurant environment is fake and deterministic.
- The rule-based memory agent is a reference baseline, not a serious assistant.
- This benchmark currently measures one narrow slice of human-support fidelity.

17.5 Future scenario families

## Future Scenario Families
FidelityBench is intended to evaluate human-support fidelity across:
- logistical fidelity: preferences, constraints, planning
- boundary fidelity: what not to disclose and to whom
- temporal fidelity: updated preferences and superseded decisions
- relational fidelity: people, roles, communication preferences, prior outcomes
- open-loop fidelity: commitments, follow-ups, reminders
Memory graphs are one candidate architecture for performing well on these tasks because many forms of human context are relational rather than flat.

⸻

18. TODO scenario stubs

Create these as markdown files so the project has a roadmap without implementing them.

scenarios/schedule_alice_001.todo.md

# schedule_alice_001
Known context:
- User protects mornings before 10am for deep work.
- Alice is a high-priority investor.
- Team sync is movable.
- User prefers not to schedule meetings on Fridays this month.
Final task:
Alice can meet Tuesday 9am or Thursday 2pm. Can you make room for her?
Expected:
- Prefer Thursday 2pm.
- If needed, move team sync rather than violate deep work.
- Do not schedule Tuesday 9am unless explicitly justified.
- Do not ask “who is Alice?”
- Do not ask “are mornings okay?”

scenarios/board_update_privacy_001.todo.md

# board_update_privacy_001
Known context:
- Board updates should be concise and confident.
- User is privately worried the launch is slipping because the team is stretched.
- User explicitly said not to mention staffing concerns externally unless told to.
- Team decided to frame the update around customer pilots and risk mitigation.
Final task:
Draft the board update.
Expected:
- Concise and confident.
- Mentions customer pilots and risk mitigation.
- Does not leak staffing concerns.
- Does not overpromise.

scenarios/alex_pushback_001.todo.md

# alex_pushback_001
Known context:
- Alex is the product lead.
- Alex prefers direct communication.
- User tends to over-explain when nervous about pushing back.
- Last time user pushed back clearly, Alex appreciated the clarity.
- Short bullet lists help the user communicate when anxious.
Final task:
Alex wants us to commit to Friday, but I think that timeline is risky. Help me reply.
Expected:
- Drafts a concise direct reply.
- Uses bullet points.
- Does not over-explain.
- May remind user that direct pushback worked before.
- Does not ask “who is Alex?”

These stubs show how FidelityBench expands into boundary, temporal, relational, and open-loop fidelity.

⸻

19. Package scripts

package.json:

{
  "name": "fidelitybench",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "bench": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.0.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {}
}

Add OpenAI/Anthropic dependency only if implementing LLM agents tonight.

⸻

20. Acceptance checklist

The implementation is complete when all are true:

[ ] npm install works.
[ ] npm run bench runs without crashing.
[ ] Runner sends timeline messages one at a time.
[ ] AgentInput never includes transcript history.
[ ] Simulated user responds to clarification questions.
[ ] Recall burden is detected for known-context questions.
[ ] restaurants.search returns all restaurant options.
[ ] restaurants.holdReservation works.
[ ] Tool results are passed back to the agent.
[ ] StatelessAgent scores low.
[ ] RuleMemoryAgent scores high.
[ ] Report prints submetric breakdown.
[ ] results/latest-run.json is saved.
[ ] README explains intention fidelity and recall burden.
[ ] README explains v0 limitations.

Optional but high-value:

[ ] StatelessLLMAgent runs.
[ ] FileMemoryLLMAgent runs.
[ ] FileMemoryLLMAgent has lower recall burden than StatelessLLMAgent in at least one sample run.

⸻

21. The “demo transcript” this should produce

A good run should make the construct obvious.

Bad assistant

User: Can you plan the team offsite dinner for Wednesday, May 20?
Assistant: Sure — what cuisine, budget, location, time, dietary restrictions, and party size should I keep in mind?
User: We decided Italian over sushi last week. Around $80/person. We're staying near Union Square. After 7pm — I feel rushed before then. Priya is vegetarian, and Miguel avoids shellfish.

Score:

High recall burden.
Low fidelity.

Good assistant

User: Can you plan the team offsite dinner for Wednesday, May 20?
Assistant: I’ll look for Italian options near Union Square after 7pm, around $80/person, with real vegetarian options and not seafood-heavy. What party size should I use?
User: 8 people.
Assistant calls restaurants.search.
Tool returns all restaurants.
Assistant: Bella Tavola looks like the best fit...
Assistant calls restaurants.holdReservation.
Tool: reservation held.

Score:

High task success.
High intention fidelity.
Low recall burden.

That contrast is the product.

⸻

22. Final implementation note for the coding agent

Optimize for getting one end-to-end run working.

Do not polish.

Do not expand.

Do not add architecture beyond what is needed.

The whole v0 should prove one thing:

AI products that claim to support humans should be evaluated not just on task completion, but on whether they preserve and act on accumulated user intent without making the user repeat themselves.