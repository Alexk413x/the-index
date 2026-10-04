import type { IndexAgentStep, IndexEffort, IndexHarness, IndexHost, IndexPanel } from '../types'
import { MAIN, MODEL_CHOICES, fmtNum, modelLabel, type Config } from './format'
import { isRecord } from './git'

export type RowItem = { text: string; color: string; pick?: string; pad?: number }

export const PANELS: readonly IndexPanel[] = ['harness', 'effort', 'model', 'session']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const ROW_GAP = 2
export const TITLE_WIDTH = 10
export const MIDDLE_WIDTH = 60

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
}

export function sectionWidth(items: readonly RowItem[]): number {
  return items.reduce((sum, item) => sum + item.text.length + (item.pad ?? 0), 0) + ROW_GAP * Math.max(0, items.length - 1)
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
