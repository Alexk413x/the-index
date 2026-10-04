import type { IndexAgentStep, IndexCallPoint, IndexEffort, IndexHarness, IndexHost, IndexPanel } from '../types'
import { barChart, lineChart } from './charts'
import { MAIN, MODEL_CHOICES, fmtCost, fmtNum, modelLabel, type Config } from './format'
import { isRecord } from './git'
import type { UsageSummary } from './ledger'

export type RowItem = { text: string; color: string; pick?: string; pad?: number; tight?: boolean }

export const PANELS: readonly IndexPanel[] = ['harness', 'effort', 'model', 'session', 'calls', 'totals', 'usage']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const ROW_GAP = 2
export const TITLE_WIDTH = 10
export const MIDDLE_WIDTH = 60
export const CHART_HEIGHT = 6
export const RECENT_CALLS = 10
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

  const chartRows = (label: string, chart: RowItem[][], notes: readonly (RowItem | null)[]): RowItem[][] =>
    chart.map((row, r) => [r === 0 ? title(label) : { ...note(''), pad: TITLE_WIDTH }, ...row, ...(notes[r] ? [notes[r]] : [])])
  const tokensColor = cfg.colors.model
  const costColor = cfg.colors.cold
  const colored = (text: string, color: string): RowItem => ({ text, color })

  if (panel === 'calls' || panel === 'totals') {
    const log = panel === 'calls' ? view.callLog.slice(-RECENT_CALLS) : view.callLog
    let sumTokens = 0
    let sumCost = 0
    const tokens = log.map(c => (panel === 'calls' ? c.tokens : (sumTokens += c.tokens)))
    const costs = log.map(c => (panel === 'calls' ? (c.costUsd ?? 0) : (sumCost += c.costUsd ?? 0)))
    const chart = lineChart(
      [
        { values: tokens, color: tokensColor },
        { values: costs, color: costColor },
      ],
      MIDDLE_WIDTH,
      CHART_HEIGHT,
      cfg.colors.icons,
    )
    const peak = (values: number[]) => Math.max(0, ...values)
    const notes: (RowItem | null)[] = Array.from({ length: CHART_HEIGHT }, () => null)
    if (log.length === 0) {
      notes[CHART_HEIGHT - 1] = note('no calls yet')
    } else if (panel === 'calls') {
      notes[0] = colored(`▲ ${fmtNum(peak(tokens))} tokens`, tokensColor)
      notes[1] = colored(`▲ $${fmtCost(peak(costs))}`, costColor)
      notes[CHART_HEIGHT - 1] = note(`last ${log.length} ${log.length === 1 ? 'call' : 'calls'}`)
    } else {
      notes[0] = colored(`${fmtNum(sumTokens)} tokens`, tokensColor)
      notes[1] = colored(`$${fmtCost(sumCost)}`, costColor)
      notes[CHART_HEIGHT - 1] = note(`${log.length} ${log.length === 1 ? 'call' : 'calls'} this session`)
    }
    return chartRows(panel === 'calls' ? 'Calls' : 'Totals', chart, notes)
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
