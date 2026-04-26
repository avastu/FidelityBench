import { dinnerOffsiteBundle } from "../scenarios/dinner_offsite_001.js"
import { OracleAgent } from "./agents/OracleAgent.js"
import { RuleMemoryAgent } from "./agents/RuleMemoryAgent.js"
import { StatelessAgent } from "./agents/StatelessAgent.js"
import { StdioAgent } from "./agents/StdioAgent.js"
import { printReport } from "./report.js"
import { runScenario } from "./runner.js"
import type { Agent } from "./agents/Agent.js"
import type { EvaluationResult, ScenarioBundle } from "./types.js"
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

function requestedFilter(flag: string): string | undefined {
  const idx = process.argv.findIndex((arg) => arg === flag)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function matchesAgentFilter(agent: Agent, filter: string | undefined): boolean {
  if (!filter) return true
  const normalized = filter.toLowerCase()
  const aliases = new Map<string, string>([
    ["StatelessAgent", "stateless"],
    ["RuleMemoryAgent", "rule-memory"],
    ["StatelessLLMAgent", "stateless-llm"],
    ["FileMemoryLLMAgent", "file-memory-llm"],
    ["TranscriptLLMAgent", "transcript-llm"],
  ])
  return (
    agent.name.toLowerCase() === normalized ||
    aliases.get(agent.name) === normalized
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
  // Simple shell-style tokenizer: split on whitespace, honoring quoted segments.
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

async function buildAgents(): Promise<Agent[]> {
  const agents: Agent[] = [
    new StatelessAgent(),
    new RuleMemoryAgent(),
    new OracleAgent(),
  ]
  if (process.env.OPENAI_API_KEY) {
    const transcriptLLM = await loadOptionalAgent(
      "./agents/TranscriptLLMAgent.js",
      "TranscriptLLMAgent",
    )
    if (transcriptLLM) agents.push(transcriptLLM)
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
  ]
  for (const [modulePath, exportName] of optional) {
    const bundle = await loadOptionalScenario(modulePath, exportName)
    if (bundle) scenarios.push(bundle)
  }
  return scenarios
}

async function main() {
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

  const allResults: EvaluationResult[] = []
  for (const bundle of scenarios) {
    const scenarioResults: EvaluationResult[] = []
    for (const agent of agents) {
      const result = await runScenario(agent, bundle)
      scenarioResults.push(result)
    }
    printReport(scenarioResults)
    console.log("")
    allResults.push(...scenarioResults)
  }

  await fs.mkdir("results", { recursive: true })
  await fs.writeFile(
    "results/latest-run.json",
    JSON.stringify(allResults, null, 2),
  )

  // Tear down subprocess-backed agents so the bench process can exit cleanly.
  for (const agent of allAgents) {
    const candidate = agent as Agent & { dispose?: () => void }
    if (typeof candidate.dispose === "function") candidate.dispose()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
