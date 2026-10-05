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
  output?: number
  tpsSum?: number
  tpsCalls?: number
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

export type IndexPanel =
  | 'harness'
  | 'effort'
  | 'model'
  | 'session'
  | 'context'
  | 'calls'
  | 'callLines'
  | 'totals'
  | 'totalLines'
  | 'usage'
  | 'branch'
  | 'base'

export type IndexHarness = { name: string; label: string }

export type IndexCallPoint = {
  at: number
  turnId: string
  tokens: number
  input: number
  cacheRead: number
  output: number
  apiMs: number
  costUsd: number | null
  cacheWrite?: number
  linesAdded?: number
  linesRemoved?: number
}

export type IndexContextPoint = { at: number; percent: number; tokens: number | null; compaction?: 'manual' | 'auto' | 'plugin' }

export type IndexContextLimit = { window: number; threshold: number | null }

export type IndexCommit = {
  sha: string
  at: number
  subject: string
  added: number
  removed: number
  files: number
  filesAdded?: number
  filesDeleted?: number
}

export type IndexPullRequest = { number: number; title: string; url: string; branch: string }

export type IndexMergedPr = {
  number: number
  title: string
  url: string
  added: number
  removed: number
  files: number
  commits: number
  openedAt: number
  mergedAt: number
}

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
      contextLog: readonly IndexContextPoint[]
      contextLimit: IndexContextLimit | null
      baseCommits: readonly IndexCommit[]
      branchCommits: readonly IndexCommit[]
      mergedPrs: readonly IndexMergedPr[]
      basePrs: readonly IndexPullRequest[]
      usageSummary: IndexUsageSummary | null
    }
  }
}
