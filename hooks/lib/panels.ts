import type {
  IndexAgentStep,
  IndexCommit,
  IndexContextLimit,
  IndexDeviceRepo,
  IndexContextPoint,
  IndexEffort,
  IndexHarness,
  IndexHost,
  IndexPanel,
  IndexMergedPr,
  IndexPullRequest,
  IndexTurn,
  IndexTurnRecord,
  IndexUsageSummary,
  IndexWorktree,
} from '../../types'
import { isRecord } from './git'
import { MAIN, learnModels, type Config, type GitLinks } from './format'
import { EFFORTS } from './panels/constants'
import { gitLines } from './panels/git'
import { rowKit } from './panels/kit'
import { meterLines } from './panels/meters'
import { pickerLines } from './panels/pickers'
import { sessionLines } from './panels/session'
import { worktreeLines } from './panels/worktrees'

// Re-exported so importers keep one entry point.
export {
  CHART_HEIGHT,
  CONTEXT_PICK,
  DETAIL_PICK,
  EFFORTS,
  FOLDER_PICK,
  GIT_LINES_HALF,
  MESSAGES_PICK,
  MIDDLE_WIDTH,
  ROW_GAP,
  TITLE_WIDTH,
  USAGE_DAYS,
} from './panels/constants'
export { padTo, sectionWidth } from './panels/kit'

export type RowItem = {
  text: string
  color: string
  pick?: string
  pad?: number
  tight?: boolean
  hoverId?: string
  detail?: string
  footer?: boolean
  swaps?: Readonly<Record<string, { text: string; color: string }>>
  details?: Readonly<Record<string, readonly DetailPart[]>>
  link?: boolean
}

export type DetailPart = { text: string; color: string }

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
  'worktrees',
]

type Settings = Readonly<Record<string, unknown>>

function effortSetting(value: unknown): IndexEffort | undefined {
  if (typeof value === 'number') return value
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value) ? (value as IndexEffort) : undefined
}

export function savedEffortFor(settings: Settings, model: string): IndexEffort | undefined {
  const perModel = settings['modelSettings']
  const entry = isRecord(perModel) ? perModel[model.replace(/\[1m\]$/, '')] : undefined
  return effortSetting(isRecord(entry) ? entry['effortLevel'] : undefined) ?? effortSetting(settings['effortLevel'])
}

export function knownModels(seen: Readonly<Record<string, string>>, liveModel: string, settings: Settings): Record<string, string> {
  const perModel = settings['modelSettings']
  return learnModels(seen, [liveModel, settings['model'], ...Object.keys(isRecord(perModel) ? perModel : {})])
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
  modelIds: Readonly<Record<string, string>>
  ultracode: boolean
  contextTokens: number | null
  host: IndexHost | null
  agentColor?: string
  startedAt: number | null
  attached: number
  turn: IndexTurn | null
  sessionCostUsd: number | null
  usage: IndexUsageSummary | null
  contextLog: readonly IndexContextPoint[]
  contextLimit: IndexContextLimit | null
  contextSeries: string | null
  baseCommits: readonly IndexCommit[]
  baseRef: string
  branchCommits: readonly IndexCommit[]
  uncommitted: { added: number; removed: number; filesAdded: number; filesModified: number; filesDeleted: number } | null
  mergedPrs: readonly IndexMergedPr[]
  turnHistory: readonly IndexTurnRecord[]
  links: GitLinks
  basePrs: readonly IndexPullRequest[]
  worktrees?: readonly IndexWorktree[]
  deviceRepos?: readonly IndexDeviceRepo[]
  cacheLeftMs: number | null
  now: number
}

export function transcriptTitle(text: string): string {
  let ai = ''
  let custom = ''
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue
    try {
      const entry: unknown = JSON.parse(line)
      if (typeof entry !== 'object' || entry === null) continue
      const { type, aiTitle, customTitle } = entry as Record<string, unknown>
      if (type === 'custom-title' && typeof customTitle === 'string') custom = customTitle
      else if (type === 'ai-title' && typeof aiTitle === 'string') ai = aiTitle
    } catch {
      continue
    }
  }
  return custom || ai
}

export function worktreePaths(view: Pick<PanelView, 'worktrees' | 'deviceRepos'>): string[] {
  return [
    ...(view.worktrees ?? []).map(t => t.path),
    ...(view.deviceRepos ?? []).flatMap(r => [r.path, ...r.trees.map(t => t.path)]),
  ]
}

export function panelLines(panel: IndexPanel, view: PanelView): RowItem[][] {
  const kit = rowKit(view)
  if (panel === 'worktrees') return worktreeLines(view, kit)
  if (panel === 'base' || panel === 'branch') return gitLines(panel, view, kit)
  if (panel === 'context' || panel === 'calls' || panel === 'callLines' || panel === 'totals' || panel === 'totalLines' || panel === 'usage') {
    return meterLines(panel, view, kit)
  }
  if (panel === 'harness' || panel === 'effort' || panel === 'model') return pickerLines(panel, view, kit)
  return sessionLines(view, kit)
}

export function rowOrder(
  slots: readonly IndexPanel[],
  pinned: readonly IndexPanel[],
  hovered: IndexPanel | null,
  shown: readonly IndexPanel[],
): IndexPanel[] {
  return slots.filter(p => shown.includes(p) && (pinned.includes(p) || p === hovered))
}
