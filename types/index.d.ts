export type IndexEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto' | number

export type IndexAgentStep = {
  model: string
  effort?: IndexEffort
}

export type IndexCall = {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  apiMs: number
  costUsd: number | null
  linesAdded: number
  linesRemoved: number
}

export type IndexTotals = {
  requests: number
  input: number
  cacheWrite: number
  cacheRead: number
  apiMs: number
  ewmaHit: number | null
  linesAdded: number
  linesRemoved: number
  lastResponseAt: number | null
  markAdded: number
  markRemoved: number
  markCostUsd: number | null
  cacheTtlMs?: number
}

export type IndexRateLimit = {
  usedPercentage: number
  resetsAt: number
}

export type IndexUsage = {
  startedAt: number
  contextPercent: number | null
  contextTokens: number | null
  costUsd: number | null
  fiveHour: IndexRateLimit | null
  sevenDay: IndexRateLimit | null
  compactions: number
  lastPercent: number | null
}

export type IndexGit = {
  branch: string
  branchPushed: boolean
  prNumber?: number
  prLink?: string
  repoWeb: string
  filesAdded: number
  filesModified: number
  filesDeleted: number
  linesAdded: number
  linesRemoved: number
  prBaseRef: string
  prBaseName: string
  prFilesAdded: number
  prFilesModified: number
  prFilesDeleted: number
  prLinesAdded: number
  prLinesRemoved: number
  prAhead: number
  prBehind: number
}

export type IndexHost = {
  sessionName: string
  sessionId?: string
  bridgeId?: string
  cwd?: string
  version?: string
  bridged: boolean
  ide: string
  agent: string
  project: string
}

export type IndexPanel = 'harness' | 'effort' | 'model' | 'session' | 'calls' | 'totals' | 'usage'

export type IndexHarness = { name: string; label: string }

export type IndexCallPoint = { at: number; tokens: number; costUsd: number | null }

export type IndexDayTotal = { date: string; tokens: number; costUsd: number | null }

export type IndexUsageSummary = { days: readonly IndexDayTotal[]; allTokens: number; allCostUsd: number; since: string | null }

export type IndexHover = { panel: IndexPanel; closing: boolean }

declare module 'claude-code' {
  interface PluginState {
    'the-index': {
      agents: Readonly<Record<string, IndexAgentStep>>
      call: IndexCall | null
      totals: IndexTotals
      usage: IndexUsage | null
      git: IndexGit | null
      host: IndexHost | null
      tick: number
      clients: Readonly<Record<string, string>>
      agentEfforts: Readonly<Record<string, Exclude<IndexEffort, 'auto'>>>
      agentModels: Readonly<Record<string, string>>
      pinned: readonly IndexPanel[]
      slots: readonly IndexPanel[]
      hover: IndexHover | null
      harnesses: readonly IndexHarness[] | null
      ultracode: boolean
      agentColors: Readonly<Record<string, string>>
      callLog: readonly IndexCallPoint[]
      usageSummary: IndexUsageSummary | null
    }
  }
}
