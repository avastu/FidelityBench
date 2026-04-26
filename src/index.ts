import { dinnerOffsiteBundle } from "../scenarios/dinner_offsite_001.js"
import { OracleAgent } from "./agents/OracleAgent.js"
import { RuleMemoryAgent } from "./agents/RuleMemoryAgent.js"
import { StatelessAgent } from "./agents/StatelessAgent.js"
import { StdioAgent } from "./agents/StdioAgent.js"
import { printReport, printAggregateSummary } from "./report.js"
import { runScenario } from "./runner.js"
import { aggregateTrials } from "./trials.js"
import type { Agent } from "./agents/Agent.js"
import type {
  AggregatedResult,
  EvaluationResult,
  ScenarioBundle,
} from "./types.js"
import fs from "node:fs/promises"

type AgentConstructor = new () => Agent

function isAgentConstructor(value: unknown): value is AgentConstructor {
  return typeof value === "function"
}

try {
  await import("dotenv/config")
} catch {
  // dotenv is optional
}

async function loadOptionalAgent(
  modulePath: string,
  exportName: string,
): Promise<Agent | undefined> {
  try {
    const importedModule: Record<string, unknown> = await import(modulePath)
    const candidate = importedModule[exportName]
    if (!isAgentConstructor(candidate)) {
      throw new Error(
        `Module ${modulePath} does not export a constructible ${exportName}.`,
      )
    }
    return new candidate()
  } catch (error) {
    if (
      error instanceof Error &&
      /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve module specifier/i.test(
        error.message,
      )
    ) {
      return undefined
    }
    throw error
  }
}

async function loadOptionalScenario(
  modulePath: string,
  exportName: string,
): Promise<ScenarioBundle | undefined> {
  try {
    const mod: Record<string, unknown> = await import(modulePath)
    const candidate = mod[exportName]
    if (
      candidate &&
      typeof candidate === "object" &&
      "scenario" in candidate &&
      "judge" in candidate &&
      "simulatedUser" in candidate
    ) {
      return candidate as ScenarioBundle
    }
    return undefined
  } catch (error) {
    if (
      error instanceof Error &&
      /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve module specifier/i.test(
        error.message,
      )
    ) {
      return undefined
    }
    throw error
  }
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function requestedFilter(flag: string): string | undefined {
  const idx = process.argv.findIndex((arg) => arg === flag)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

const AGENT_ALIASES = new Map<string, string>([
  ["StatelessAgent", "stateless"],
  ["RuleMemoryAgent", "rule-memory"],
  ["OracleAgent", "oracle"],
  ["StatelessLLMAgent", "stateless-llm"],
  ["FileMemoryLLMAgent", "file-memory-llm"],
  ["TranscriptLLMAgent", "transcript-llm"],
  ["BlockMemoryLLMAgent", "block-memory"],
  ["WindowedTranscriptLLMAgent", "windowed-transcript"],
])

function matchesAgentFilter(agent: Agent, filter: string | undefined): boolean {
  if (!filter) return true
  const normalized = filter.toLowerCase()
  return (
    agent.name.toLowerCase() === normalized ||
    AGENT_ALIASES.get(agent.name) === normalized
  )
}

function matchesScenarioFilter(
  bundle: ScenarioBundle,
  filter: string | undefined,
): boolean {
  if (!filter) return true
  return bundle.scenario.id.toLowerCase().includes(filter.toLowerCase())
}

function parseExternalAgentCommand(spec: string): { command: string; args: string[] } {
  const tokens: string[] = []
  let current = ""
  let inSingle = false
  let inDouble = false
  for (const ch of spec) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) tokens.push(current)
  if (tokens.length === 0) {
    throw new Error("FIDELITYBENCH_EXTERNAL_AGENT is empty")
  }
  const [command, ...args] = tokens as [string, ...string[]]
  return { command, args }
}

function hasLlmCredentials(): boolean {
  return !!(
    process.env.BEDROCK_API_KEY ||
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
    process.env.OPENAI_API_KEY
  )
}

async function buildAgents(): Promise<Agent[]> {
  const includeOracle = hasFlag("--include-oracle")
  const agents: Agent[] = [new StatelessAgent(), new RuleMemoryAgent()]
  if (includeOracle) agents.push(new OracleAgent())

  if (hasLlmCredentials()) {
    const transcriptLLM = await loadOptionalAgent(
      "./agents/TranscriptLLMAgent.js",
      "TranscriptLLMAgent",
    )
    if (transcriptLLM) agents.push(transcriptLLM)

    const blockMemory = await loadOptionalAgent(
      "./agents/BlockMemoryLLMAgent.js",
      "BlockMemoryLLMAgent",
    )
    if (blockMemory) agents.push(blockMemory)

    const windowedTranscript = await loadOptionalAgent(
      "./agents/WindowedTranscriptLLMAgent.js",
      "WindowedTranscriptLLMAgent",
    )
    if (windowedTranscript) agents.push(windowedTranscript)

    if (process.env.OPENAI_API_KEY) {
      const statelessLLM = await loadOptionalAgent(
        "./agents/StatelessLLMAgent.js",
        "StatelessLLMAgent",
      )
      if (statelessLLM) agents.push(statelessLLM)
      const fileMemoryLLM = await loadOptionalAgent(
        "./agents/FileMemoryLLMAgent.js",
        "FileMemoryLLMAgent",
      )
      if (fileMemoryLLM) agents.push(fileMemoryLLM)
    }
  } else {
    process.stderr.write(
      "[FidelityBench] LLM agents skipped — set BEDROCK_API_KEY (preferred) or OPENAI_API_KEY to enable TranscriptLLMAgent + BlockMemoryLLMAgent.\n",
    )
  }
  if (!includeOracle) {
    process.stderr.write(
      "[FidelityBench] OracleAgent skipped — pass --include-oracle to run the hand-coded sanity-check baseline.\n",
    )
  }

  const externalSpec = process.env.FIDELITYBENCH_EXTERNAL_AGENT
  if (externalSpec && externalSpec.trim().length > 0) {
    const { command, args } = parseExternalAgentCommand(externalSpec.trim())
    const name = process.env.FIDELITYBENCH_EXTERNAL_AGENT_NAME?.trim() || "ExternalAgent"
    const timeoutEnv = process.env.FIDELITYBENCH_EXTERNAL_AGENT_TIMEOUT_MS
    const timeoutMs = timeoutEnv ? parseInt(timeoutEnv, 10) : undefined
    agents.push(new StdioAgent({ name, command, args, timeoutMs }))
  }

  return agents
}

async function loadScenarios(): Promise<ScenarioBundle[]> {
  const scenarios: ScenarioBundle[] = [dinnerOffsiteBundle]
  const optional: Array<[string, string]> = [
    [
      "../scenarios/temporal_supersession_001.js",
      "temporalSupersessionBundle",
    ],
    [
      "../scenarios/board_update_privacy_001.js",
      "boardUpdatePrivacyBundle",
    ],
    [
      "../scenarios/reflect_difficult_week_001.js",
      "reflectDifficultWeekBundle",
    ],
    [
      "../scenarios/alex_pushback_001.js",
      "alexPushbackBundle",
    ],
  ]
  for (const [modulePath, exportName] of optional) {
    const bundle = await loadOptionalScenario(modulePath, exportName)
    if (bundle) scenarios.push(bundle)
  }
  return scenarios
}

function printHelp() {
  console.log(`FidelityBench v1.6 — eval intention fidelity in AI agents

Usage:
  npm run bench [-- options]

Options:
  --agent <name>           run only the given agent (alias or class name)
  --scenario <substring>   run only scenarios whose id contains <substring>
  --trials <N>             run nondeterministic agents N times per scenario;
                           report mean ± stddev. Deterministic agents always run once.
                           Default: 1.
  --include-oracle         include the hand-coded OracleAgent (rubric sanity check)
                           — also enables the side-by-side contrast block in the
                           diagnostic report
  --no-diagnose            suppress the v1.6 Diagnosis + Contrast blocks
                           (recovers the pre-v1.6 report shape)
  --json                   emit machine-readable JSONL to stdout
                           (each trial + each result; human report stays on stderr)
  --list-agents            print the agents that would run, then exit
  --list-scenarios         print the scenarios available, then exit
  --help, -h               this help

External agents (any language) integrate via stdio JSON. See README.md and
examples/external-agent.py.`)
}

async function listAgents(): Promise<void> {
  const agents = await buildAgents()
  for (const agent of agents) {
    const alias = AGENT_ALIASES.get(agent.name) ?? "(no alias)"
    console.log(`${agent.name}\t${alias}`)
  }
}

async function listScenarios(): Promise<void> {
  const scenarios = await loadScenarios()
  for (const bundle of scenarios) {
    console.log(`${bundle.scenario.id}\t${bundle.scenario.title}`)
  }
}

// JSON output: write one EvaluationResult per line to stdout, plus an aggregate
// summary line at the end. Each line is self-describing via a "kind" field so
// downstream tooling can dispatch.
function emitJsonLine(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function buildAggregate(results: EvaluationResult[]) {
  // Group by agent → sum totals across scenarios
  const byAgent = new Map<
    string,
    { agentName: string; total: number; scenarios: number; scores: Record<string, number> }
  >()
  for (const r of results) {
    const existing = byAgent.get(r.agentName)
    if (!existing) {
      byAgent.set(r.agentName, {
        agentName: r.agentName,
        total: r.totalScore,
        scenarios: 1,
        scores: { [r.scenarioId]: r.totalScore },
      })
    } else {
      existing.total += r.totalScore
      existing.scenarios += 1
      existing.scores[r.scenarioId] = r.totalScore
    }
  }
  return [...byAgent.values()]
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp()
    return
  }
  if (hasFlag("--list-agents")) {
    await listAgents()
    return
  }
  if (hasFlag("--list-scenarios")) {
    await listScenarios()
    return
  }

  const jsonMode = hasFlag("--json")
  // Diagnosis is on by default. --no-diagnose recovers the pre-v1.6 report shape.
  const diagnose = !hasFlag("--no-diagnose")
  const log = (msg: string) => {
    if (jsonMode) process.stderr.write(msg + "\n")
    else console.log(msg)
  }
  // Redirect printReport to stderr in json mode by capturing console.log temporarily.
  const origConsoleLog = console.log.bind(console)
  if (jsonMode) {
    console.log = (...args: unknown[]) => {
      process.stderr.write(args.map(String).join(" ") + "\n")
    }
  }

  try {
    const allAgents = await buildAgents()
    const allScenarios = await loadScenarios()

    const agentFilter = requestedFilter("--agent")
    const scenarioFilter = requestedFilter("--scenario")

    const agents = allAgents.filter((agent) =>
      matchesAgentFilter(agent, agentFilter),
    )
    const scenarios = allScenarios.filter((bundle) =>
      matchesScenarioFilter(bundle, scenarioFilter),
    )

    if (agents.length === 0) {
      throw new Error(
        agentFilter
          ? `No agent matched --agent ${agentFilter}.`
          : "No agents are available to run.",
      )
    }
    if (scenarios.length === 0) {
      throw new Error(
        scenarioFilter
          ? `No scenario matched --scenario ${scenarioFilter}.`
          : "No scenarios are available.",
      )
    }

    const trialsArg = requestedFilter("--trials")
    const trialsRequested = trialsArg ? Math.max(1, parseInt(trialsArg, 10)) : 1
    if (trialsRequested > 1) {
      process.stderr.write(
        `[FidelityBench] --trials ${trialsRequested} — nondeterministic agents will run ${trialsRequested}×; deterministic agents run once.\n`,
      )
    }

    const allResults: (EvaluationResult | AggregatedResult)[] = []
    for (const bundle of scenarios) {
      const scenarioResults: (EvaluationResult | AggregatedResult)[] = []
      for (const agent of agents) {
        const trials = agent.nondeterministic ? trialsRequested : 1
        const trialResults: EvaluationResult[] = []
        for (let t = 0; t < trials; t += 1) {
          const r = await runScenario(agent, bundle)
          r.trialIndex = t
          trialResults.push(r)
          if (jsonMode) {
            emitJsonLine({
              kind: "trial",
              trialIndex: t,
              trialsTotal: trials,
              agentName: r.agentName,
              scenarioId: r.scenarioId,
              totalScore: r.totalScore,
              taskSuccess: r.taskSuccess,
              intentFidelity: r.intentFidelity,
              recallBurden: r.recallBurden,
              clarificationQuality: r.clarificationQuality,
              toolUseEfficiency: r.toolUseEfficiency,
              recallBurdenCategories: [
                ...new Set(r.recallBurdenEvents.map((e) => e.category)),
              ],
              selectedRestaurantId: r.selectedRestaurantId,
              heldReservation: r.heldReservation,
              intentDimensionResults: r.intentDimensionResults,
              notes: r.notes,
            })
          }
        }
        const display = trials > 1 ? aggregateTrials(trialResults) : trialResults[0]
        if (display) scenarioResults.push(display)
        if (jsonMode && trials > 1 && display) {
          const agg = display as AggregatedResult
          emitJsonLine({
            kind: "result",
            agentName: agg.agentName,
            scenarioId: agg.scenarioId,
            totalScore: agg.totalScore,
            stddev: agg.stddev,
            trials: agg.trials,
          })
        } else if (jsonMode && display) {
          emitJsonLine({
            kind: "result",
            agentName: display.agentName,
            scenarioId: display.scenarioId,
            totalScore: display.totalScore,
            trials: 1,
          })
        }
      }
      printReport(scenarioResults, bundle, { diagnose })
      console.log("")
      allResults.push(...scenarioResults)
    }

    const aggregate = buildAggregate(allResults)
    printAggregateSummary(allResults, scenarios)
    if (jsonMode) {
      for (const a of aggregate) {
        emitJsonLine({ kind: "aggregate", ...a })
      }
    }

    await fs.mkdir("results", { recursive: true })
    await fs.writeFile(
      "results/latest-run.json",
      JSON.stringify({ results: allResults, aggregate }, null, 2),
    )

    for (const agent of allAgents) {
      const candidate = agent as Agent & { dispose?: () => void }
      if (typeof candidate.dispose === "function") candidate.dispose()
    }
  } finally {
    if (jsonMode) console.log = origConsoleLog
  }
  log("")
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
