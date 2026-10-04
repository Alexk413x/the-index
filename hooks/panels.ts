import type {
  IndexAgentStep,
  IndexCallPoint,
  IndexCommit,
  IndexContextLimit,
  IndexContextPoint,
  IndexEffort,
  IndexHarness,
  IndexHost,
  IndexPanel,
  IndexWorktreeLog,
} from '../types'
import { barChart, divergingBars, lineChart, markerRow } from './charts'
import { MAIN, MODEL_CHOICES, fmtCost, fmtDur, fmtNum, modelLabel, type Config, type GitLinks } from './format'
import { isRecord } from './git'
import type { UsageSummary } from './ledger'

export type RowItem = {
  text: string
  color: string
  pick?: string
  pad?: number
  tight?: boolean
  hoverId?: string
  detail?: string
  footer?: boolean
}

export const PANELS: readonly IndexPanel[] = ['harness', 'effort', 'model', 'session', 'context', 'calls', 'totals', 'usage', 'branch', 'base']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const ROW_GAP = 2
export const TITLE_WIDTH = 10
export const MIDDLE_WIDTH = 60
export const CHART_HEIGHT = 6
export const TURN_SLOTS = 20
export const TURN_HALF = 3

export type Turn = {
  id: string
  number: number
  tokens: number
  input: number
  cacheRead: number
  output: number
  apiMs: number
  costUsd: number | null
}

export function groupTurns(log: readonly IndexCallPoint[]): Turn[] {
  const turns: Turn[] = []
  for (const call of log) {
    let turn = turns[turns.length - 1]
    if (!turn || turn.id !== call.turnId) {
      turn = { id: call.turnId, number: turns.length + 1, tokens: 0, input: 0, cacheRead: 0, output: 0, apiMs: 0, costUsd: 0 }
      turns.push(turn)
    }
    turn.tokens += call.tokens
    turn.input += call.input
    turn.cacheRead += call.cacheRead
    turn.output += call.output
    turn.apiMs += call.apiMs
    turn.costUsd = turn.costUsd === null || call.costUsd === null ? null : turn.costUsd + call.costUsd
  }
  return turns
}

function perMillion(costUsd: number, tokens: number): string {
  return `$${((costUsd / tokens) * 1_000_000).toFixed(2)}/M`
}

export function turnDetail(turn: Turn): string {
  const parts = [`turn ${turn.number}`, `${fmtNum(turn.tokens)} tokens`]
  if (turn.costUsd !== null) parts.push(`$${fmtCost(turn.costUsd)}`)
  if (turn.costUsd !== null && turn.tokens > 0) parts.push(perMillion(turn.costUsd, turn.tokens))
  if (turn.input > 0) parts.push(`${Math.floor((turn.cacheRead / turn.input) * 100)}% cache`)
  parts.push(`↓${fmtNum(turn.output)}`)
  if (turn.apiMs > 0) parts.push(`${(turn.output / (turn.apiMs / 1000)).toFixed(0)} tok/s`)
  return parts.join(' · ')
}
export const USAGE_DAYS = 30

type Settings = Readonly<Record<string, unknown>>

export function effortSetting(value: unknown): IndexEffort | undefined {
  if (typeof value === 'number') return value
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value) ? (value as IndexEffort) : undefined
}

export function savedEffortFor(settings: Settings, model: string): IndexEffort | undefined {
  const perModel = settings['modelSettings']
  const entry = isRecord(perModel) ? perModel[model.replace(/\[1m\]$/, '')] : undefined
  return effortSetting(isRecord(entry) ? entry['effortLevel'] : undefined) ?? effortSetting(settings['effortLevel'])
}

export function mainStep(liveModel: string, step: IndexAgentStep | undefined, settings: Settings): IndexAgentStep {
  const model = liveModel || step?.model || ''
  return { model, effort: step?.effort ?? savedEffortFor(settings, model) }
}

export type Choices = {
  model: string
  effort: IndexEffort | undefined
  modelIsDefault: boolean
  effortIsDefault: boolean
}

export function currentChoices(
  target: string,
  step: IndexAgentStep | undefined,
  picked: { model?: string; effort?: IndexEffort },
  settings: Settings,
): Choices {
  const model = (picked.model ?? step?.model ?? '').replace(/\[1m\]$/, '')
  const effort = picked.effort ?? step?.effort
  if (target !== MAIN) {
    return { model, effort, modelIsDefault: picked.model === undefined, effortIsDefault: picked.effort === undefined }
  }
  const savedModel = typeof settings['model'] === 'string' ? settings['model'] : ''
  return {
    model,
    effort,
    modelIsDefault: savedModel === '' || savedModel === 'default',
    effortIsDefault: effort === 'auto' || savedEffortFor(settings, model) === undefined,
  }
}

export type PanelView = {
  cfg: Config
  choices: Choices
  harnesses: readonly IndexHarness[] | null
  ultracode: boolean
  contextTokens: number | null
  host: IndexHost | null
  agentColor?: string
  startedAt: number | null
  attached: number
  callLog: readonly IndexCallPoint[]
  usage: UsageSummary | null
  contextLog: readonly IndexContextPoint[]
  contextLimit: IndexContextLimit | null
  baseCommits: readonly IndexCommit[]
  baseRef: string
  worktree: IndexWorktreeLog | null
  links: GitLinks
  cacheLeftMs: number | null
  now: number
}

export function sectionWidth(items: readonly RowItem[]): number {
  return items.reduce((sum, item, i) => sum + item.text.length + (item.pad ?? 0) + (i > 0 && !item.tight ? ROW_GAP : 0), 0)
}

export function padTo(items: readonly RowItem[], width: number): RowItem[] {
  const last = items[items.length - 1]
  if (!last) return [...items]
  return [...items.slice(0, -1), { ...last, pad: (last.pad ?? 0) + Math.max(0, width - sectionWidth(items)) }]
}

export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function panelLines(panel: IndexPanel, view: PanelView): RowItem[][] {
  const { cfg, choices } = view
  const note = (text: string): RowItem => ({ text, color: cfg.colors.icons })
  const title = (text: string): RowItem => ({ ...note(text), pad: Math.max(0, TITLE_WIDTH - text.length) })
  const choice = (text: string, pick: string, isCurrent: boolean): RowItem =>
    isCurrent ? { text, color: cfg.colors.model } : { text, color: cfg.colors.icons, pick }
  const middle = (items: RowItem[]) => padTo(items, MIDDLE_WIDTH)
  const middleEndingWith = (items: RowItem[], end: RowItem) => [...padTo(items, MIDDLE_WIDTH - ROW_GAP - end.text.length), end]
  const recache = note(`may re-cache ${view.contextTokens ? `about ${fmtNum(view.contextTokens)} tokens` : 'the conversation'}`)

  const chartRows = (label: string, chart: RowItem[][], notes: readonly (RowItem | null)[], actions: RowItem[] = []): RowItem[][] => {
    const rows = chart.map((row, r) => [
      r === 0 && actions.length === 0 ? title(label) : { ...note(''), pad: TITLE_WIDTH },
      ...row,
      ...(notes[r] ? [notes[r]] : []),
    ])
    return actions.length ? [[title(label), ...actions], ...rows] : rows
  }
  const action = (text: string, url: string): RowItem => ({ text: `${text} ↗`, color: cfg.colors.branch, pick: url })
  const tokensColor = cfg.colors.model
  const costColor = cfg.colors.cold
  const colored = (text: string, color: string): RowItem => ({ text, color })

  if (panel === 'base') {
    const commits = [...view.baseCommits].reverse()
    const chart = lineChart(
      [
        { values: commits.map(c => c.added), color: cfg.colors.good },
        { values: commits.map(c => c.removed), color: cfg.colors.bad },
        { values: commits.map(c => c.files), color: cfg.colors.warn },
      ],
      MIDDLE_WIDTH,
      CHART_HEIGHT,
      cfg.colors.icons,
    )
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    const latest = commits[commits.length - 1]
    if (!latest) {
      notes[CHART_HEIGHT - 1] = note(`no commits on ${view.baseRef || 'the base branch'}`)
    } else {
      notes[0] = colored(`▲ +${fmtNum(Math.max(...commits.map(c => c.added)))} lines`, cfg.colors.good)
      notes[1] = colored(`▲ -${fmtNum(Math.max(...commits.map(c => c.removed)))} lines`, cfg.colors.bad)
      notes[2] = colored(`▲ ${Math.max(...commits.map(c => c.files))} files`, cfg.colors.warn)
      notes[3] = note(latest.subject.length > 34 ? `${latest.subject.slice(0, 33)}…` : latest.subject)
      notes[CHART_HEIGHT - 1] = note(`last ${commits.length} ${commits.length === 1 ? 'commit' : 'commits'} to ${view.baseRef}`)
    }
    return chartRows('Commits', chart, notes, view.links.base ? [action(view.links.base.label, view.links.base.url)] : [])
  }

  if (panel === 'branch') {
    const log = view.worktree
    const points = log?.points ?? []
    const span = log ? Math.max(1, view.now - log.since) : 1
    const xs = points.map(p => (p.at - (log?.since ?? 0)) / span)
    const chart = lineChart(
      [
        { values: points.map(p => p.added), color: cfg.colors.good, xs },
        { values: points.map(p => p.removed), color: cfg.colors.bad, xs },
        { values: points.map(p => p.files), color: cfg.colors.warn, xs },
      ],
      MIDDLE_WIDTH,
      CHART_HEIGHT,
      cfg.colors.icons,
    )
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    const latest = points[points.length - 1]
    if (!log) {
      notes[CHART_HEIGHT - 1] = note('no commit yet')
    } else {
      const hours = Math.max(1 / 60, (view.now - log.since) / 3_600_000)
      if (latest) {
        notes[0] = colored(`+${fmtNum(latest.added)} lines`, cfg.colors.good)
        notes[1] = colored(`-${fmtNum(latest.removed)} lines`, cfg.colors.bad)
        notes[2] = colored(`${latest.files} ${latest.files === 1 ? 'file' : 'files'}`, cfg.colors.warn)
        notes[3] = note(`${fmtNum(Math.round((latest.added + latest.removed) / hours))} lines an hour`)
      }
      notes[CHART_HEIGHT - 1] = note(`${fmtDur((view.now - log.since) / 1000)} since the last commit`)
    }
    return chartRows('Changes', chart, notes, view.links.branch ? [action('View branch', view.links.branch)] : [])
  }

  if (panel === 'context') {
    const log = view.contextLog
    const limit = view.contextLimit
    const thresholdPct = limit?.threshold ? Math.min(100, (limit.threshold / limit.window) * 100) : null
    const series = [{ values: log.map(p => p.percent), color: tokensColor, max: 100 }]
    if (thresholdPct !== null) series.push({ values: [thresholdPct, thresholdPct], color: cfg.colors.warn, max: 100 })
    const marked = log.flatMap((p, i) => (p.compaction ? [i] : []))
    const chart = [
      ...lineChart(series, MIDDLE_WIDTH, CHART_HEIGHT - 1, cfg.colors.icons),
      markerRow(log.length, marked, MIDDLE_WIDTH, '▲', cfg.colors.high, cfg.colors.icons),
    ]
    const now = log[log.length - 1]
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    if (limit) notes[0] = note(`100% · ${fmtNum(limit.window)} window`)
    if (thresholdPct !== null) notes[1] = colored(`compacts at ${Math.round(thresholdPct)}%`, cfg.colors.warn)
    if (view.cacheLeftMs !== null) {
      notes[4] = view.cacheLeftMs > 0
        ? colored(`cache warm · ${fmtDur(view.cacheLeftMs / 1000)} left`, cfg.colors.good)
        : colored('cache cold · next call re-reads it', cfg.colors.cold)
    }
    if (now) {
      notes[2] = colored(`now ${now.percent}%${now.tokens === null ? '' : ` · ${fmtNum(now.tokens)}`}`, tokensColor)
      notes[3] = note(`peak ${Math.max(...log.map(p => p.percent))}%`)
      notes[CHART_HEIGHT - 1] = marked.length
        ? colored(`▲ ${marked.length} ${marked.length === 1 ? 'compaction' : 'compactions'}`, cfg.colors.high)
        : note('no compactions')
    } else {
      notes[CHART_HEIGHT - 1] = note('no readings yet')
    }
    return chartRows('Context', chart, notes)
  }

  if (panel === 'calls') {
    const turns = groupTurns(view.callLog)
    const known = turns.filter(t => t.costUsd !== null && t.tokens > 0)
    const knownTokens = known.reduce((sum, t) => sum + t.tokens, 0)
    const knownCost = known.reduce((sum, t) => sum + (t.costUsd ?? 0), 0)
    const average = knownTokens > 0 ? knownCost / knownTokens : 0
    const bars = turns.map(t => ({
      id: `turn-${t.id}`,
      value: t.costUsd === null || t.tokens === 0 ? null : t.costUsd / t.tokens,
      detail: turnDetail(t),
    }))
    const chart = divergingBars(bars, average, TURN_SLOTS, Math.floor(MIDDLE_WIDTH / TURN_SLOTS) - 1, TURN_HALF, {
      above: cfg.colors.bad,
      below: cfg.colors.good,
      axis: cfg.colors.icons,
      blank: cfg.colors.icons,
    })
    const notes: (RowItem | null)[] = Array.from({ length: TURN_HALF * 2 + 1 }, () => null)
    if (known.length > 0) {
      notes[0] = colored('▲ dearer per token', cfg.colors.bad)
      notes[TURN_HALF] = note(`avg ${perMillion(knownCost, knownTokens)} tokens`)
      notes[TURN_HALF * 2] = colored('▼ cheaper per token', cfg.colors.good)
    }
    const footer: RowItem = {
      text: turns.length ? `hover a bar for its turn · last ${Math.min(turns.length, TURN_SLOTS)} of ${turns.length}` : 'no turns yet',
      color: cfg.colors.icons,
      footer: true,
    }
    return [...chartRows('Cost/tok', chart, notes), [{ ...note(''), pad: TITLE_WIDTH }, footer]]
  }

  if (panel === 'totals') {
    const log = view.callLog
    let sumTokens = 0
    let sumCost = 0
    const tokens = log.map(c => (sumTokens += c.tokens))
    const costs = log.map(c => (sumCost += c.costUsd ?? 0))
    const chart = lineChart(
      [
        { values: tokens, color: tokensColor },
        { values: costs, color: costColor },
      ],
      MIDDLE_WIDTH,
      CHART_HEIGHT,
      cfg.colors.icons,
    )
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    if (log.length === 0) {
      notes[CHART_HEIGHT - 1] = note('no calls yet')
    } else {
      notes[0] = colored(`${fmtNum(sumTokens)} tokens`, tokensColor)
      notes[1] = colored(`$${fmtCost(sumCost)}`, costColor)
      notes[CHART_HEIGHT - 1] = note(`${log.length} ${log.length === 1 ? 'call' : 'calls'} this session`)
    }
    return chartRows('Totals', chart, notes)
  }

  if (panel === 'usage') {
    const usage = view.usage
    const days = usage?.days ?? []
    const values = usage ? days.map(d => (usage.since && d.date >= usage.since ? d.tokens : null)) : Array<null>(USAGE_DAYS).fill(null)
    const chart = barChart(values, Math.max(1, Math.floor(MIDDLE_WIDTH / USAGE_DAYS)), CHART_HEIGHT, tokensColor, cfg.colors.icons)
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    if (!usage?.since) {
      notes[CHART_HEIGHT - 1] = note('no usage recorded yet')
    } else {
      const known = days.filter(d => d.date >= (usage.since ?? ''))
      const monthTokens = known.reduce((sum, d) => sum + d.tokens, 0)
      const monthCost = known.reduce((sum, d) => sum + (d.costUsd ?? 0), 0)
      notes[0] = colored(`▲ ${fmtNum(Math.max(0, ...known.map(d => d.tokens)))} a day`, tokensColor)
      notes[1] = colored(`today ${fmtNum(days[days.length - 1]?.tokens ?? 0)}`, tokensColor)
      notes[2] = note(`${days.length} days ${fmtNum(monthTokens)} · $${fmtCost(monthCost)}`)
      notes[3] = note(`all time ${fmtNum(usage.allTokens)} · $${fmtCost(usage.allCostUsd)}`)
      notes[CHART_HEIGHT - 1] = note(`since ${usage.since}`)
    }
    return chartRows('Usage', chart, notes)
  }

  if (panel === 'harness') {
    if (!view.harnesses) return []
    return [[title('Open'), ...middle(view.harnesses.map(h => choice(h.label, h.name, false))), note('in a new tab')]]
  }
  if (panel === 'effort') {
    const levels = [
      ...EFFORTS.map(level => choice(level, level, level === choices.effort)),
      note('·'),
      { text: 'ultracode', color: view.ultracode ? cfg.colors.model : cfg.colors.icons, pick: 'ultracode' },
    ]
    return [[title('Effort'), ...middleEndingWith(levels, choice('default', 'default', choices.effortIsDefault)), recache]]
  }
  if (panel === 'model') {
    const models = MODEL_CHOICES.map(c => choice(modelLabel(c.id), c.alias, c.id === choices.model))
    return [[title('Model'), ...middleEndingWith(models, choice('default', 'default', choices.modelIsDefault)), recache]]
  }

  const host = view.host
  if (!host) return []
  const value = (text: string, color = cfg.colors.session): RowItem => ({ text, color })
  const rows: [string, RowItem[], RowItem | null][] = [
    [
      'Session',
      [value(host.sessionName || 'unnamed'), note('·'), value(host.sessionId ?? '')],
      view.startedAt === null ? null : note(`started ${clockTime(view.startedAt)}`),
    ],
  ]
  rows.push([
    'Agent',
    [value(host.agent || 'none', host.agent ? cfg.colors.model : cfg.colors.icons)],
    host.agent ? note(view.agentColor ? `colour ${view.agentColor}` : 'no colour') : null,
  ])
  if (host.bridgeId) {
    rows.push([
      'Remote',
      [value(host.bridgeId, view.attached ? cfg.colors.good : cfg.colors.session)],
      note(view.attached ? `${view.attached} attached` : 'none attached'),
    ])
  }
  rows.push(['Folder', [value(host.cwd ?? '')], note(`Claude Code ${host.version ?? ''}`)])
  return rows.map(([label, values, extra]) => [title(label), ...middle(values), ...(extra ? [extra] : [])])
}

export function rowOrder(
  slots: readonly IndexPanel[],
  pinned: readonly IndexPanel[],
  hovered: IndexPanel | null,
  shown: readonly IndexPanel[],
): IndexPanel[] {
  return slots.filter(p => shown.includes(p) && (pinned.includes(p) || p === hovered))
}
