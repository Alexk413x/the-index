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
import { barChart, columnBars, divergingBars, lineChart, markerRow } from './charts'
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

export const PANELS: readonly IndexPanel[] = [
  'harness',
  'effort',
  'model',
  'session',
  'context',
  'calls',
  'callLines',
  'totals',
  'totalLines',
  'usage',
  'branch',
  'base',
]
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
  linesAdded: number | null
  linesRemoved: number | null
  start: number
  end: number
}

export function groupTurns(log: readonly IndexCallPoint[]): Turn[] {
  const turns: Turn[] = []
  for (const call of log) {
    // Calls logged by a build before turns were recorded carry no turn id or token split.
    if (typeof call.turnId !== 'string') continue
    let turn = turns[turns.length - 1]
    if (!turn || turn.id !== call.turnId) {
      turn = {
        id: call.turnId,
        number: turns.length + 1,
        tokens: 0,
        input: 0,
        cacheRead: 0,
        output: 0,
        apiMs: 0,
        costUsd: 0,
        linesAdded: 0,
        linesRemoved: 0,
        start: call.at - call.apiMs,
        end: call.at,
      }
      turns.push(turn)
    }
    turn.start = Math.min(turn.start, call.at - call.apiMs)
    turn.end = Math.max(turn.end, call.at)
    turn.linesAdded = turn.linesAdded === null || call.linesAdded === undefined ? null : turn.linesAdded + call.linesAdded
    turn.linesRemoved = turn.linesRemoved === null || call.linesRemoved === undefined ? null : turn.linesRemoved + call.linesRemoved
    turn.tokens += call.tokens
    turn.input += call.input
    turn.cacheRead += call.cacheRead
    turn.output += call.output
    turn.apiMs += call.apiMs
    turn.costUsd = turn.costUsd === null || call.costUsd === null ? null : turn.costUsd + call.costUsd
  }
  return turns
}

export function turnLines(turn: Turn): number {
  return (turn.linesAdded ?? 0) + (turn.linesRemoved ?? 0)
}

function perLine(costUsd: number, lines: number): string {
  return `$${fmtCost(costUsd / lines)}/line`
}

function perMinute(lines: number, ms: number): string {
  return `${ms > 0 ? Math.round(lines / (ms / 60_000)) : 0} lines/min`
}

export function linesDetail(turn: Turn): string {
  const lines = turnLines(turn)
  const parts = [`turn ${turn.number}`, `+${turn.linesAdded ?? 0} -${turn.linesRemoved ?? 0} lines`, fmtDur((turn.end - turn.start) / 1000)]
  if (lines > 0) parts.push(perMinute(lines, turn.end - turn.start))
  if (lines > 0 && turn.costUsd !== null) parts.push(perLine(turn.costUsd, lines))
  return parts.join(' · ')
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
      notes[0] = colored('▲ costs more per token', cfg.colors.bad)
      notes[TURN_HALF] = note(`avg ${perMillion(knownCost, knownTokens)} tokens`)
      notes[TURN_HALF * 2] = colored('▼ costs less per token', cfg.colors.good)
    }
    const footer: RowItem = {
      text: turns.length ? `hover a bar for its turn · last ${Math.min(turns.length, TURN_SLOTS)} of ${turns.length}` : 'no turns yet',
      color: cfg.colors.icons,
      footer: true,
    }
    return [...chartRows('Cost/tok', chart, notes), [{ ...note(''), pad: TITLE_WIDTH }, footer]]
  }

  if (panel === 'callLines') {
    const turns = groupTurns(view.callLog).filter(t => t.linesAdded !== null && t.linesRemoved !== null)
    const priced = turns.filter(t => turnLines(t) > 0 && t.costUsd !== null)
    const pricedLines = priced.reduce((sum, t) => sum + turnLines(t), 0)
    const pricedCost = priced.reduce((sum, t) => sum + (t.costUsd ?? 0), 0)
    const average = pricedLines > 0 ? pricedCost / pricedLines : null
    const bars = turns.map(t => {
      const lines = turnLines(t)
      const cost = lines > 0 && t.costUsd !== null ? t.costUsd / lines : null
      const color = cost === null || average === null ? cfg.colors.icons : cost <= average ? cfg.colors.good : cfg.colors.bad
      return { value: lines, color, id: `lines-${t.id}`, detail: linesDetail(t) }
    })
    const chart = columnBars(bars, TURN_SLOTS, Math.floor(MIDDLE_WIDTH / TURN_SLOTS) - 1, CHART_HEIGHT, cfg.colors.icons)
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    const changed = turns.reduce((sum, t) => sum + turnLines(t), 0)
    if (changed > 0) {
      const activeMs = turns.reduce((sum, t) => sum + (t.end - t.start), 0)
      notes[0] = colored(`▲ ${fmtNum(Math.max(...turns.map(turnLines)))} lines`, tokensColor)
      notes[1] = note(`avg ${perMinute(changed, activeMs)}`)
      if (average !== null) notes[2] = note(`avg ${perLine(pricedCost, pricedLines)}`)
      notes[3] = colored('■ costs less per line', cfg.colors.good)
      notes[4] = colored('■ costs more per line', cfg.colors.bad)
    }
    const footer: RowItem = {
      text: turns.length
        ? changed > 0
          ? `hover a bar for its turn · last ${Math.min(turns.length, TURN_SLOTS)} of ${turns.length}`
          : 'no lines changed yet'
        : 'no turns yet',
      color: cfg.colors.icons,
      footer: true,
    }
    return [...chartRows('Lines', chart, notes), [{ ...note(''), pad: TITLE_WIDTH }, footer]]
  }

  if (panel === 'totals') {
    const log = view.callLog.filter(c => typeof c.turnId === 'string' && typeof c.cacheWrite === 'number')
    if (log.length === 0) return [[title('Totals'), note('no calls yet')]]
    const running = <T,>(pick: (sums: Record<string, number>, call: IndexCallPoint) => T): T[] => {
      const sums: Record<string, number> = { sent: 0, write: 0, read: 0, input: 0, output: 0, cost: 0, tps: 0, tpsCalls: 0 }
      return log.map(call => {
        sums['sent'] = (sums['sent'] ?? 0) + call.input - (call.cacheWrite ?? 0) - call.cacheRead
        sums['write'] = (sums['write'] ?? 0) + (call.cacheWrite ?? 0)
        sums['read'] = (sums['read'] ?? 0) + call.cacheRead
        sums['input'] = (sums['input'] ?? 0) + call.input
        sums['output'] = (sums['output'] ?? 0) + call.output
        sums['cost'] = (sums['cost'] ?? 0) + (call.costUsd ?? 0)
        if (call.output > 0 && call.apiMs > 0) {
          sums['tps'] = (sums['tps'] ?? 0) + call.output / (call.apiMs / 1000)
          sums['tpsCalls'] = (sums['tpsCalls'] ?? 0) + 1
        }
        return pick(sums, call)
      })
    }
    const at = (key: string) => running(s => s[key] ?? 0)
    const tps = running(s => ((s['tpsCalls'] ?? 0) > 0 ? (s['tps'] ?? 0) / (s['tpsCalls'] ?? 1) : 0))
    const hit = running(s => ((s['input'] ?? 0) > 0 ? ((s['read'] ?? 0) / (s['input'] ?? 1)) * 100 : 0))
    const last = (values: number[]) => values[values.length - 1] ?? 0
    const rows: [string, number[], string, string][] = [
      ['↑ sent', at('sent'), fmtNum(last(at('sent'))), tokensColor],
      ['⤒ written', at('write'), fmtNum(last(at('write'))), tokensColor],
      ['⤓ read', at('read'), fmtNum(last(at('read'))), tokensColor],
      ['↓ output', at('output'), fmtNum(last(at('output'))), tokensColor],
      ['↯ tok/s', tps, last(tps).toFixed(0), cfg.colors.warn],
      ['⌖ hit', hit, `${Math.floor(last(hit))}%`, cfg.colors.good],
      ['$ cost', at('cost'), `$${fmtCost(last(at('cost')))}`, costColor],
    ]
    return [
      ...rows.map(([label, values, current, color]) => [
        title(label),
        ...(lineChart([{ values, color }], MIDDLE_WIDTH, 1, cfg.colors.icons)[0] ?? []),
        colored(current, color),
      ]),
      [{ ...note(''), pad: TITLE_WIDTH }, note(`over ${log.length} ${log.length === 1 ? 'call' : 'calls'}`)],
    ]
  }

  if (panel === 'totalLines') {
    const turns = groupTurns(view.callLog).filter(t => t.linesAdded !== null && t.linesRemoved !== null)
    let lines = 0
    let activeMs = 0
    let cost = 0
    const cumulative: number[] = []
    const speed: number[] = []
    const perLineCost: number[] = []
    for (const t of turns) {
      lines += turnLines(t)
      activeMs += t.end - t.start
      cost += t.costUsd ?? 0
      cumulative.push(lines)
      speed.push(activeMs > 0 ? lines / (activeMs / 60_000) : 0)
      perLineCost.push(lines > 0 ? cost / lines : 0)
    }
    const chart = lineChart(
      [
        { values: cumulative, color: cfg.colors.good },
        { values: speed, color: cfg.colors.warn },
        { values: perLineCost, color: costColor },
      ],
      MIDDLE_WIDTH,
      CHART_HEIGHT,
      cfg.colors.icons,
    )
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    if (lines === 0) {
      notes[CHART_HEIGHT - 1] = note(turns.length ? 'no lines changed yet' : 'no turns yet')
    } else {
      const added = turns.reduce((sum, t) => sum + (t.linesAdded ?? 0), 0)
      const removed = turns.reduce((sum, t) => sum + (t.linesRemoved ?? 0), 0)
      notes[0] = colored(`+${fmtNum(added)} -${fmtNum(removed)} lines`, cfg.colors.good)
      notes[1] = colored(perMinute(lines, activeMs), cfg.colors.warn)
      notes[2] = colored(perLine(cost, lines), costColor)
      notes[CHART_HEIGHT - 1] = note(`over ${turns.length} ${turns.length === 1 ? 'turn' : 'turns'}`)
    }
    return chartRows('Lines', chart, notes)
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
