export type GraphNodeType =
  | "person"
  | "project"
  | "preference"
  | "constraint"
  | "decision"
  | "boundary"
  | "pattern"
  | "event"
  | "location"
  | "task"
  | "other"

export type GraphEdgeType =
  | "role_of"
  | "preference_of"
  | "constraint_on"
  | "boundary_about"
  | "causes"
  | "supports"
  | "updates"
  | "supersedes"
  | "tradeoff"
  | "prior_outcome"
  | "communication_style"
  | "format_preference"
  | "related_to"

export type MemoryGraphNode = {
  id: string
  label: string
  type: GraphNodeType
  summary: string
  evidence: string
  firstSeen: string
  lastSeen: string
  mentionCount: number
  active: boolean
}

export type MemoryGraphEdge = {
  id: string
  source: string
  target: string
  type: GraphEdgeType
  summary: string
  evidence: string
  firstSeen: string
  lastSeen: string
  weight: number
  active: boolean
}

export type MemoryObservation = {
  id: string
  text: string
  nodeIds: string[]
  timestamp: string
  active: boolean
}

export type GraphExtractionPatch = {
  nodes: Array<{
    label: string
    type?: string
    summary?: string
    evidence?: string
  }>
  edges: Array<{
    source: string
    target: string
    type?: string
    summary?: string
    evidence?: string
  }>
  observations: Array<{
    text: string
    labels?: string[]
  }>
  deactivateLabels: string[]
}

export type RetrievedGraphContext = {
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  observations: MemoryObservation[]
}

const NODE_TYPES = new Set<GraphNodeType>([
  "person",
  "project",
  "preference",
  "constraint",
  "decision",
  "boundary",
  "pattern",
  "event",
  "location",
  "task",
  "other",
])

const EDGE_TYPES = new Set<GraphEdgeType>([
  "role_of",
  "preference_of",
  "constraint_on",
  "boundary_about",
  "causes",
  "supports",
  "updates",
  "supersedes",
  "tradeoff",
  "prior_outcome",
  "communication_style",
  "format_preference",
  "related_to",
])

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "can",
  "for",
  "from",
  "he",
  "her",
  "him",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "this",
  "to",
  "us",
  "we",
  "what",
  "when",
  "with",
  "you",
  "your",
])

export class MemoryGraph {
  private nodes = new Map<string, MemoryGraphNode>()
  private edges = new Map<string, MemoryGraphEdge>()
  private observations: MemoryObservation[] = []
  private observationCounter = 0

  reset() {
    this.nodes.clear()
    this.edges.clear()
    this.observations = []
    this.observationCounter = 0
  }

  applyPatch(patch: GraphExtractionPatch, timestamp: string) {
    for (const label of patch.deactivateLabels) {
      const id = nodeIdFor(label)
      const node = this.nodes.get(id)
      if (node) {
        node.active = false
        node.lastSeen = timestamp
      }
      for (const edge of this.edges.values()) {
        if (edge.source === id || edge.target === id) {
          edge.active = false
          edge.lastSeen = timestamp
        }
      }
    }

    for (const raw of patch.nodes) {
      const label = cleanText(raw.label)
      if (!label) continue
      const id = nodeIdFor(label)
      const type = parseNodeType(raw.type)
      const summary = cleanText(raw.summary) || label
      const evidence = cleanText(raw.evidence)
      const existing = this.nodes.get(id)
      if (existing) {
        existing.type = type
        existing.summary = summary
        existing.evidence = evidence || existing.evidence
        existing.lastSeen = timestamp
        existing.mentionCount += 1
        existing.active = true
      } else {
        this.nodes.set(id, {
          id,
          label,
          type,
          summary,
          evidence,
          firstSeen: timestamp,
          lastSeen: timestamp,
          mentionCount: 1,
          active: true,
        })
      }
    }

    for (const raw of patch.edges) {
      const source = ensureNode(this.nodes, raw.source, timestamp)
      const target = ensureNode(this.nodes, raw.target, timestamp)
      if (!source || !target || source === target) continue
      const type = parseEdgeType(raw.type)
      const id = edgeIdFor(source, target, type)
      const summary = cleanText(raw.summary) || `${this.nodes.get(source)?.label} ${type} ${this.nodes.get(target)?.label}`
      const evidence = cleanText(raw.evidence)
      const existing = this.edges.get(id)
      if (existing) {
        existing.summary = summary
        existing.evidence = evidence || existing.evidence
        existing.lastSeen = timestamp
        existing.weight += 1
        existing.active = true
      } else {
        this.edges.set(id, {
          id,
          source,
          target,
          type,
          summary,
          evidence,
          firstSeen: timestamp,
          lastSeen: timestamp,
          weight: 1,
          active: true,
        })
      }
    }

    for (const raw of patch.observations) {
      const text = cleanText(raw.text)
      if (!text) continue
      const labels = raw.labels && raw.labels.length > 0
        ? raw.labels
        : patch.nodes.map((node) => node.label)
      const nodeIds = labels
        .map((label) => ensureNode(this.nodes, label, timestamp))
        .filter((id): id is string => !!id)
      this.observations.push({
        id: `obs-${++this.observationCounter}`,
        text,
        nodeIds: [...new Set(nodeIds)],
        timestamp,
        active: true,
      })
    }
  }

  retrieveGraph(query: string, limit = 18): RetrievedGraphContext {
    const activeNodes = [...this.nodes.values()].filter((node) => node.active)
    const activeEdges = [...this.edges.values()].filter((edge) => edge.active)
    const tokens = tokenize(expandQuery(query))
    const scores = new Map<string, number>()

    for (const node of activeNodes) {
      let score = lexicalScore(tokens, `${node.label} ${node.type} ${node.summary} ${node.evidence}`)
      score += salience(node)
      if (/\b(user|assistant)\b/i.test(node.label)) score -= 2
      scores.set(node.id, score)
    }

    for (const edge of activeEdges) {
      const edgeScore =
        lexicalScore(tokens, `${edge.type} ${edge.summary} ${edge.evidence}`) +
        edge.weight * 0.5
      if (edgeScore > 0) {
        scores.set(edge.source, (scores.get(edge.source) ?? 0) + edgeScore)
        scores.set(edge.target, (scores.get(edge.target) ?? 0) + edgeScore)
      }
    }

    const seeded = [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(6, Math.floor(limit / 2)))
      .map(([id]) => id)

    for (const edge of activeEdges) {
      if (seeded.includes(edge.source)) {
        scores.set(edge.target, (scores.get(edge.target) ?? 0) + 2 + edge.weight * 0.25)
      }
      if (seeded.includes(edge.target)) {
        scores.set(edge.source, (scores.get(edge.source) ?? 0) + 2 + edge.weight * 0.25)
      }
    }

    const selectedIds = [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id)

    const selected = new Set(selectedIds)
    const nodes = selectedIds
      .map((id) => this.nodes.get(id))
      .filter((node): node is MemoryGraphNode => !!node)
    const edges = activeEdges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .sort((a, b) => b.weight - a.weight || b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, 28)
    return { nodes, edges, observations: [] }
  }

  retrieveHybrid(query: string, nodeLimit = 18, observationLimit = 12): RetrievedGraphContext {
    const graph = this.retrieveGraph(query, nodeLimit)
    const nodeIds = new Set(graph.nodes.map((node) => node.id))
    const tokens = tokenize(expandQuery(query))
    const observations = this.observations
      .filter((observation) => observation.active)
      .map((observation) => {
        const overlap = observation.nodeIds.filter((id) => nodeIds.has(id)).length
        const score = lexicalScore(tokens, observation.text) + overlap * 2
        return { observation, score }
      })
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.observation.timestamp.localeCompare(a.observation.timestamp),
      )
      .slice(0, observationLimit)
      .map(({ observation }) => observation)
    return { ...graph, observations }
  }

  format(context: RetrievedGraphContext, includeObservations: boolean): string {
    const labels = new Map(this.nodes)
    const lines: string[] = []
    lines.push("## Retrieved Nodes")
    if (context.nodes.length === 0) lines.push("(none)")
    for (const node of context.nodes) {
      lines.push(
        `- [${node.type}] ${node.label}: ${node.summary} (active: ${node.active}; lastSeen: ${node.lastSeen})`,
      )
      if (node.evidence) lines.push(`  evidence: ${node.evidence}`)
    }

    lines.push("")
    lines.push("## Retrieved Edges")
    if (context.edges.length === 0) lines.push("(none)")
    for (const edge of context.edges) {
      const source = labels.get(edge.source)?.label ?? edge.source
      const target = labels.get(edge.target)?.label ?? edge.target
      lines.push(
        `- ${source} --${edge.type}--> ${target}: ${edge.summary} (weight: ${edge.weight}; lastSeen: ${edge.lastSeen})`,
      )
      if (edge.evidence) lines.push(`  evidence: ${edge.evidence}`)
    }

    if (includeObservations) {
      lines.push("")
      lines.push("## Semantic Memory Snippets")
      if (context.observations.length === 0) lines.push("(none)")
      for (const observation of context.observations) {
        lines.push(`- ${observation.text} (${observation.timestamp})`)
      }
    }
    return lines.join("\n")
  }
}

export function emptyPatch(): GraphExtractionPatch {
  return { nodes: [], edges: [], observations: [], deactivateLabels: [] }
}

export function parseGraphExtraction(rawText: string): GraphExtractionPatch {
  try {
    const parsed: unknown = JSON.parse(stripCodeFences(rawText))
    if (!isRecord(parsed)) return emptyPatch()
    const nodes = Array.isArray(parsed.nodes)
      ? parsed.nodes.flatMap((node) => parseNodePatch(node))
      : []
    const edges = Array.isArray(parsed.edges)
      ? parsed.edges.flatMap((edge) => parseEdgePatch(edge))
      : []
    const observations = Array.isArray(parsed.observations)
      ? parsed.observations.flatMap((observation) => parseObservationPatch(observation))
      : []
    const deactivateLabels = Array.isArray(parsed.deactivateLabels)
      ? parsed.deactivateLabels.filter((label): label is string => typeof label === "string")
      : []
    return { nodes, edges, observations, deactivateLabels }
  } catch {
    return emptyPatch()
  }
}

function parseNodePatch(value: unknown): GraphExtractionPatch["nodes"] {
  if (!isRecord(value) || typeof value.label !== "string") return []
  return [
    {
      label: value.label,
      type: typeof value.type === "string" ? value.type : undefined,
      summary: typeof value.summary === "string" ? value.summary : undefined,
      evidence: typeof value.evidence === "string" ? value.evidence : undefined,
    },
  ]
}

function parseEdgePatch(value: unknown): GraphExtractionPatch["edges"] {
  if (
    !isRecord(value) ||
    typeof value.source !== "string" ||
    typeof value.target !== "string"
  ) {
    return []
  }
  return [
    {
      source: value.source,
      target: value.target,
      type: typeof value.type === "string" ? value.type : undefined,
      summary: typeof value.summary === "string" ? value.summary : undefined,
      evidence: typeof value.evidence === "string" ? value.evidence : undefined,
    },
  ]
}

function parseObservationPatch(value: unknown): GraphExtractionPatch["observations"] {
  if (!isRecord(value) || typeof value.text !== "string") return []
  const labels = Array.isArray(value.labels)
    ? value.labels.filter((label): label is string => typeof label === "string")
    : undefined
  return [{ text: value.text, labels }]
}

function ensureNode(
  nodes: Map<string, MemoryGraphNode>,
  label: string,
  timestamp: string,
): string | undefined {
  const clean = cleanText(label)
  if (!clean) return undefined
  const id = nodeIdFor(clean)
  if (!nodes.has(id)) {
    nodes.set(id, {
      id,
      label: clean,
      type: "other",
      summary: clean,
      evidence: "",
      firstSeen: timestamp,
      lastSeen: timestamp,
      mentionCount: 0,
      active: true,
    })
  }
  return id
}

function parseNodeType(value: string | undefined): GraphNodeType {
  if (value && NODE_TYPES.has(value as GraphNodeType)) return value as GraphNodeType
  return "other"
}

function parseEdgeType(value: string | undefined): GraphEdgeType {
  if (value && EDGE_TYPES.has(value as GraphEdgeType)) return value as GraphEdgeType
  return "related_to"
}

function nodeIdFor(label: string): string {
  return normalize(label)
}

function edgeIdFor(source: string, target: string, type: GraphEdgeType): string {
  return `${source}|${type}|${target}`
}

function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function normalize(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "unknown"
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

function expandQuery(query: string): string {
  const expansions: string[] = [query]
  if (/\breply|respond|message|draft|write\b/i.test(query)) {
    expansions.push("communication style format preference recipient context privacy boundary")
  }
  if (/\bcommit|deadline|timeline|risky|risk\b/i.test(query)) {
    expansions.push("deadline timeline risk constraint alternative tradeoff")
  }
  if (/\bbook|reserve|reservation|lunch|dinner|restaurant\b/i.test(query)) {
    expansions.push("restaurant cuisine dietary vegetarian budget location time party")
  }
  if (/\breflect|heard|vent|week\b/i.test(query)) {
    expansions.push("reflection events feelings boundary advice")
  }
  return expansions.join(" ")
}

function lexicalScore(tokens: string[], text: string): number {
  if (tokens.length === 0) return 0
  const haystack = new Set(tokenize(text))
  let score = 0
  for (const token of tokens) {
    if (haystack.has(token)) score += 2
    else if ([...haystack].some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))) {
      score += 1
    }
  }
  return score
}

function salience(node: MemoryGraphNode): number {
  let score = Math.min(3, node.mentionCount)
  if (node.type === "boundary") score += 4
  if (node.type === "constraint") score += 3
  if (node.type === "decision") score += 3
  if (node.type === "preference") score += 2.5
  if (node.type === "pattern") score += 2.5
  if (node.type === "person") score += 2
  if (node.type === "project") score += 1.5
  return score
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
