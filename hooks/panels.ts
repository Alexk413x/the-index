import type {
  IndexAgentStep,
  IndexCommit,
  IndexContextLimit,
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
} from '../types'
import {
  barChart,
  columnBars,
  lineChart,
  markColumns,
  markerRow,
  splitBars,
  stackedBars,
  type SplitBar,
  type StackedBar,
} from './charts'
import { isFix, isRecord } from './git'
import { otherSessionAverages, sessionTotals, turnAverages, turnToRecord, type Averages, type SessionTotals } from './turns'
import { MAIN, MODEL_CHOICES, SYM_FILES, SYM_LINES, fmtCost, fmtDur, fmtNum, modelLabel, type Config, type GitLinks } from './format'

export type RowItem = {
  text: string
  color: string
  pick?: string
  pad?: number
  tight?: boolean
  hoverId?: string
  detail?: string
  footer?: boolean
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
]
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const ROW_GAP = 2
export const TITLE_WIDTH = 10
export const MIDDLE_WIDTH = 60
export const CHART_HEIGHT = 6
export const GIT_LINES_HALF = 2
const GIT_FILES_HEIGHT = 3
const COMMIT_SLOTS = 10
const BRANCH_SLOTS = 20
const ACTION_WIDTH = 90
const PR_TITLE_MAX = 24
const CARD_LABEL = 18
const CARD_COLUMN = 14

export const USAGE_DAYS = 30

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
  turn: IndexTurn | null
  sessionCostUsd: number | null
  usage: IndexUsageSummary | null
  contextLog: readonly IndexContextPoint[]
  contextLimit: IndexContextLimit | null
  baseCommits: readonly IndexCommit[]
  baseRef: string
  branchCommits: readonly IndexCommit[]
  uncommitted: { added: number; removed: number; filesAdded: number; filesModified: number; filesDeleted: number } | null
  mergedPrs: readonly IndexMergedPr[]
  turnHistory: readonly IndexTurnRecord[]
  links: GitLinks
  basePrs: readonly IndexPullRequest[]
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

function padSlots<T>(list: readonly T[], slots: number): (T | null)[] {
  return [...list, ...Array<null>(Math.max(0, slots - list.length)).fill(null)]
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function clockTime(ms: number): string {
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

  const blankTitle = (): RowItem => ({ ...note(''), pad: TITLE_WIDTH })
  const chartRows = (label: string, chart: RowItem[][], notes: readonly (RowItem | null)[], actions: RowItem[] = []): RowItem[][] => {
    const rows = chart.map((row, r) => [r === 0 && actions.length === 0 ? title(label) : blankTitle(), ...row, ...(notes[r] ? [notes[r]] : [])])
    const actionLines: RowItem[][] = []
    for (const item of actions) {
      const line = actionLines[actionLines.length - 1]
      if (line && sectionWidth([...line.slice(1), item]) <= ACTION_WIDTH) line.push(item)
      else actionLines.push([actionLines.length === 0 ? title(label) : blankTitle(), item])
    }
    return [...actionLines, ...rows]
  }
  const action = (text: string, url: string): RowItem => ({ text: `${text} ↗`, color: cfg.colors.branch, pick: url, link: true })
  const tokensColor = cfg.colors.model
  const colored = (text: string, color: string): RowItem => ({ text, color })

  const baseActions = (): RowItem[] => {
    const base = view.links.base
    return [
      ...(view.links.repo ? [action('Open Repo', view.links.repo)] : []),
      ...(base ? [action(base.label, base.url)] : []),
      ...(view.links.pulls ? [action('View PRs', view.links.pulls)] : []),
      ...view.basePrs
        .filter(pr => pr.url !== base?.url)
        .flatMap(pr => [note('·'), { ...action(`PR #${pr.number}`, pr.url), detail: clip(`#${pr.number} ${pr.title}`, PR_TITLE_MAX + 40) }]),
    ]
  }

  const gitRows = (
    label: string,
    actions: RowItem[],
    header: string,
    lineBars: (SplitBar | null)[],
    fileBars: (StackedBar | null)[],
    barWidth: number,
    totals: { added: number; removed: number; filesAdded: number; filesModified: number; filesDeleted: number } | null,
    fixRow: RowItem[] | null,
    hint: string,
    details: Record<string, DetailPart[]>,
  ): RowItem[][] => {
    const opening = actions.length ? actions : header ? [note(header)] : []
    const head = opening.length ? chartRows(label, [], [], opening) : []
    const linesChart = splitBars(lineBars, barWidth, GIT_LINES_HALF, {
      up: cfg.colors.good,
      down: cfg.colors.bad,
      axis: cfg.colors.icons,
      blank: cfg.colors.icons,
    })
    const lineNotes: (RowItem | null)[] = Array.from({ length: GIT_LINES_HALF * 2 + 1 }, () => null)
    const fileNotes = totals ? fileNotesFor(totals.filesAdded, totals.filesModified, totals.filesDeleted) : Array.from({ length: GIT_FILES_HEIGHT }, () => null)
    if (totals) {
      lineNotes[0] = colored(`+${fmtNum(totals.added)} lines added`, cfg.colors.good)
      lineNotes[GIT_LINES_HALF * 2] = colored(`-${fmtNum(totals.removed)} lines removed`, cfg.colors.bad)
    }
    const block = (title_: string, chart: RowItem[][], notes: readonly (RowItem | null)[]) =>
      chart.map((row, r) => [r === 0 ? title(title_) : blankTitle(), ...row, ...(notes[r] ? [notes[r]] : [])])
    return [
      ...(actions.length && header ? [...head, [blankTitle(), note(header)]] : head),
      ...block('Lines', linesChart, lineNotes),
      [blankTitle()],
      ...block('Files', stackedBars(fileBars, barWidth, GIT_FILES_HEIGHT, cfg.colors.icons), fileNotes),
      ...(fixRow ? [fixRow] : []),
      [blankTitle(), { text: hint, color: cfg.colors.icons, footer: true, details }],
    ]
  }
  const fileParts = (added: number, modified: number, deleted: number) => [
    { value: added, color: cfg.colors.good },
    { value: modified, color: cfg.colors.warn },
    { value: deleted, color: cfg.colors.bad },
  ]
  const fileText = (added: number, modified: number, deleted: number) => `files +${added} ~${modified} -${deleted}`
  const split = (c: IndexCommit) => {
    const added = c.filesAdded ?? 0
    const deleted = c.filesDeleted ?? 0
    return { added, deleted, modified: Math.max(0, c.files - added - deleted) }
  }
  const commitParts = (
    files: { added: number; modified: number; deleted: number },
    added: number,
    removed: number,
    label: string,
    labelColor: string,
    after = '',
  ): DetailPart[] => [
    { text: `${SYM_FILES} `, color: cfg.colors.icons },
    { text: `${files.added} `, color: cfg.colors.good },
    { text: `${files.modified} `, color: cfg.colors.warn },
    { text: `${files.deleted} `, color: cfg.colors.bad },
    { text: `${SYM_LINES} `, color: cfg.colors.icons },
    { text: `+${added} `, color: cfg.colors.good },
    { text: `-${removed}  `, color: cfg.colors.bad },
    { text: label, color: labelColor },
    ...(after ? [{ text: after, color: cfg.colors.icons }] : []),
  ]
  const partsOf = (bars: readonly ({ id: string } | null)[], make: (i: number) => DetailPart[]) =>
    Object.fromEntries(bars.flatMap((bar, i) => (bar ? [[bar.id, make(i)]] : [])))
  const fileNotesFor = (added: number, modified: number, deleted: number): (RowItem | null)[] => {
    const notes: (RowItem | null)[] = Array.from({ length: GIT_FILES_HEIGHT }, () => null)
    notes[0] = colored(`+${added} files added`, cfg.colors.good)
    notes[1] = colored(`~${modified} files modified`, cfg.colors.warn)
    notes[2] = colored(`-${deleted} files deleted`, cfg.colors.bad)
    return notes
  }
  const fixMark = (subject: string, id: string, detail: string) => ({
    char: isFix(subject) ? '×' : '·',
    color: isFix(subject) ? cfg.colors.bad : cfg.colors.icons,
    id,
    detail,
  })
  const fixShare = (subjects: readonly string[], one: string, many: string): RowItem => {
    const count = subjects.filter(isFix).length
    const text = `${count} of ${subjects.length} ${subjects.length === 1 ? one : many} (${Math.round((count / subjects.length) * 100)}%)`
    return colored(text, count ? cfg.colors.bad : cfg.colors.icons)
  }

  if (panel === 'base' && view.mergedPrs.length > 0) {
    const prs = [...view.mergedPrs].reverse().slice(-COMMIT_SLOTS)
    const barWidth = Math.floor(MIDDLE_WIDTH / COMMIT_SLOTS) - 1
    const pad = <T,>(list: T[]) => padSlots(list, COMMIT_SLOTS)
    const details = prs.map(pr => {
      const titleText = clip(pr.title, 34)
      return `#${pr.number} ${titleText} · +${pr.added} -${pr.removed} · ${pr.commits} ${pr.commits === 1 ? 'commit' : 'commits'} · ${fmtDur((pr.mergedAt - pr.openedAt) / 1000)} open`
    })
    const size = columnBars(
      prs.map((pr, i) => ({ value: pr.added + pr.removed, color: tokensColor, id: `pr-${pr.number}`, detail: details[i] ?? '' })),
      COMMIT_SLOTS,
      barWidth,
      1,
      cfg.colors.icons,
    )[0] ?? []
    const merge = columnBars(
      prs.map((pr, i) => ({ value: Math.max(1, pr.mergedAt - pr.openedAt), color: cfg.colors.warn, id: `pr-${pr.number}`, detail: details[i] ?? '' })),
      COMMIT_SLOTS,
      barWidth,
      1,
      cfg.colors.icons,
    )[0] ?? []
    const fixes = markColumns(
      pad(prs.map((pr, i) => fixMark(pr.title, `pr-${pr.number}`, details[i] ?? ''))),
      barWidth,
      cfg.colors.icons,
    )
    const median = (values: number[]) => {
      const sorted = [...values].sort((x, y) => x - y)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    }
    const actions = baseActions()
    const head = actions.length ? chartRows('PRs', [], [], actions) : [[title('PRs'), note(`merged into ${view.baseRef}`)]]
    return [
      ...head,
      [title('Size'), ...size, colored(`median +${fmtNum(Math.round(median(prs.map(p => p.added))))} -${fmtNum(Math.round(median(prs.map(p => p.removed))))} per PR`, tokensColor)],
      [title('Merge'), ...merge, colored(`median ${fmtDur(median(prs.map(p => p.mergedAt - p.openedAt)) / 1000)} to merge`, cfg.colors.warn)],
      [title('Fix?'), ...fixes, fixShare(prs.map(pr => pr.title), 'PR is a fix', 'PRs are fixes')],
      [blankTitle(), { text: 'hover a column for its PR', color: cfg.colors.icons, footer: true }],
    ]
  }

  if (panel === 'base') {
    const commits = [...view.baseCommits].reverse().slice(-COMMIT_SLOTS)
    const pad = <T,>(list: T[]) => padSlots(list, COMMIT_SLOTS)
    const lineBars = pad(
      commits.map(c => {
        const f = split(c)
        const subject = clip(c.subject, 40)
        return { up: c.added, down: c.removed, id: `commit-${c.sha}`, detail: `${subject} · +${c.added} -${c.removed} · ${fileText(f.added, f.modified, f.deleted)}` }
      }),
    )
    const fileBars = pad(
      commits.map((c, i) => {
        const f = split(c)
        return { parts: fileParts(f.added, f.modified, f.deleted), id: `commit-${c.sha}`, detail: lineBars[i]?.detail ?? '' }
      }),
    )
    const sum = (pick: (c: IndexCommit) => number) => commits.reduce((total, c) => total + pick(c), 0)
    const actions = baseActions()
    const header = commits.length ? '' : `no commits on ${view.baseRef || 'the base branch'}`
    const totals = commits.length
      ? {
          added: sum(c => c.added),
          removed: sum(c => c.removed),
          filesAdded: sum(c => split(c).added),
          filesModified: sum(c => split(c).modified),
          filesDeleted: sum(c => split(c).deleted),
        }
      : null
    const barWidth = Math.floor(MIDDLE_WIDTH / COMMIT_SLOTS) - 1
    const fixRow = commits.length
      ? [
          title('Fix?'),
          ...markColumns(pad(commits.map((c, i) => fixMark(c.subject, `commit-${c.sha}`, lineBars[i]?.detail ?? ''))), barWidth, cfg.colors.icons),
          fixShare(commits.map(c => c.subject), 'commit is a fix', 'commits are fixes'),
        ]
      : null
    const details = partsOf(lineBars, i => {
      const c = commits[i]
      return c ? commitParts(split(c), c.added, c.removed, clip(c.subject, 40), cfg.colors.branch) : []
    })
    return gitRows('Commits', actions, header, lineBars, fileBars, barWidth, totals, fixRow, commits.length ? 'hover a bar for its commit' : '', details)
  }

  if (panel === 'branch') {
    const pending = view.uncommitted
    const commits = [...view.branchCommits].reverse().slice(-(BRANCH_SLOTS - (pending ? 1 : 0)))
    const actions = view.links.branch ? [action('View Branch', view.links.branch)] : []
    const head: RowItem[][] = [[title('Branch'), ...(actions.length ? actions : [note(`ahead of ${view.baseRef || 'the base branch'}`)])]]
    if (commits.length === 0 && !pending) return [...head, [blankTitle(), note(`no commits ahead of ${view.baseRef || 'the base branch'}`)]]
    const barWidth = Math.floor(MIDDLE_WIDTH / BRANCH_SLOTS) - 1
    const pad = <T,>(list: T[]) => padSlots(list, BRANCH_SLOTS)
    const details = commits.map((c, i) => {
      const previous = commits[i - 1]
      const gap = previous ? ` · ${fmtDur((c.at - previous.at) / 1000)} after the previous` : ''
      const subject = clip(c.subject, 40)
      return `${subject} · +${c.added} -${c.removed} · ${c.files} ${c.files === 1 ? 'file' : 'files'}${gap}`
    })
    const pendingFiles = pending ? pending.filesAdded + pending.filesModified + pending.filesDeleted : 0
    const pendingDetail = pending
      ? `uncommitted changes · +${pending.added} -${pending.removed} · ${pendingFiles} ${pendingFiles === 1 ? 'file' : 'files'}`
      : ''
    const lineBars = pad([
      ...commits.map((c, i) => ({ up: c.added, down: c.removed, id: `commit-${c.sha}`, detail: details[i] ?? '' })),
      ...(pending ? [{ up: pending.added, down: pending.removed, id: 'uncommitted', detail: pendingDetail }] : []),
    ])
    const fixes = pad([
      ...commits.map((c, i) => fixMark(c.subject, `commit-${c.sha}`, details[i] ?? '')),
      ...(pending ? [{ char: '○', color: cfg.colors.warn, id: 'uncommitted', detail: pendingDetail }] : []),
    ])
    const chart = splitBars(lineBars, barWidth, GIT_LINES_HALF, { up: cfg.colors.good, down: cfg.colors.bad, axis: cfg.colors.icons, blank: cfg.colors.icons })
    const notes: (RowItem | null)[] = Array.from({ length: GIT_LINES_HALF * 2 + 1 }, () => null)
    notes[0] = colored(`+${fmtNum(commits.reduce((sum, c) => sum + c.added, 0) + (pending?.added ?? 0))} lines added`, cfg.colors.good)
    const first = commits[0]
    const last = commits[commits.length - 1]
    if (first && last && commits.length > 1) notes[GIT_LINES_HALF] = note(`avg ${fmtDur((last.at - first.at) / (commits.length - 1) / 1000)} between commits`)
    notes[GIT_LINES_HALF * 2] = colored(`-${fmtNum(commits.reduce((sum, c) => sum + c.removed, 0) + (pending?.removed ?? 0))} lines removed`, cfg.colors.bad)
    const fileBars = pad([
      ...commits.map((c, i) => {
        const f = split(c)
        return { parts: fileParts(f.added, f.modified, f.deleted), id: `commit-${c.sha}`, detail: details[i] ?? '' }
      }),
      ...(pending ? [{ parts: fileParts(pending.filesAdded, pending.filesModified, pending.filesDeleted), id: 'uncommitted', detail: pendingDetail }] : []),
    ])
    const fileSum = (pick: (f: { added: number; modified: number; deleted: number }) => number) =>
      commits.reduce((sum, c) => sum + pick(split(c)), 0) +
      (pending ? pick({ added: pending.filesAdded, modified: pending.filesModified, deleted: pending.filesDeleted }) : 0)
    const fileNotes = fileNotesFor(fileSum(f => f.added), fileSum(f => f.modified), fileSum(f => f.deleted))
    const filesChart = stackedBars(fileBars, barWidth, GIT_FILES_HEIGHT, cfg.colors.icons)
    const detailParts = partsOf(lineBars, i => {
      const c = commits[i]
      if (c) {
        const previous = commits[i - 1]
        const gap = previous ? ` · ${fmtDur((c.at - previous.at) / 1000)} after the previous` : ''
        return commitParts(split(c), c.added, c.removed, clip(c.subject, 40), cfg.colors.branch, gap)
      }
      return pending
        ? commitParts(
            { added: pending.filesAdded, modified: pending.filesModified, deleted: pending.filesDeleted },
            pending.added,
            pending.removed,
            'uncommitted',
            cfg.colors.warn,
          )
        : []
    })
    return [
      ...head,
      ...chart.map((row, r) => [r === 0 ? title('Lines') : blankTitle(), ...row, ...(notes[r] ? [notes[r]] : [])]),
      [blankTitle()],
      ...filesChart.map((row, r) => [r === 0 ? title('Files') : blankTitle(), ...row, ...(fileNotes[r] ? [fileNotes[r]] : [])]),
      [
        title('Fix?'),
        ...markColumns(fixes, barWidth, cfg.colors.icons),
        commits.length ? fixShare(commits.map(c => c.subject), 'commit is a fix', 'commits are fixes') : note('no commits yet'),
      ],
      [blankTitle(), { text: pending ? 'hover a column for its commit; ○ is uncommitted' : 'hover a column for its commit', color: cfg.colors.icons, footer: true, details: detailParts }],
    ]
  }

  if (panel === 'context') {
    const log = view.contextLog
    const limit = view.contextLimit
    const thresholdPct = limit?.threshold ? Math.min(100, (limit.threshold / limit.window) * 100) : null
    const series = [{ values: log.map(p => p.percent), color: tokensColor, max: 100 }]
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

  if (panel === 'calls' || panel === 'callLines' || panel === 'totals' || panel === 'totalLines') {
    const sid = view.host?.sessionId ?? ''
    const history = view.turnHistory
    const mine = history.filter(t => t.session === sid)
    const live = view.turn ? turnToRecord(view.turn, sid, view.sessionCostUsd) : undefined
    const current = live ?? mine.at(-1)
    const sessionTurns = live && !mine.some(t => t.id === live.id) ? [...mine, live] : mine
    const icons = cfg.colors.icons
    const neutral = cfg.colors.icons
    const cell = (text: string, color: string): RowItem => ({ text, color, pad: Math.max(0, CARD_COLUMN - text.length) })
    const label = (text: string): RowItem => ({ text, color: icons, pad: Math.max(0, CARD_LABEL - text.length) })
    const judge = (value: number | null, against: number | null, better: 'lower' | 'higher' | null) => {
      if (value === null || against === null || better === null || against === 0) return neutral
      const change = (value - against) / Math.abs(against)
      if (Math.abs(change) < 0.02) return neutral
      return (change < 0) === (better === 'lower') ? cfg.colors.good : cfg.colors.bad
    }
    type Metric = { name: string; values: (number | null)[]; show: (v: number) => string; better: 'lower' | 'higher' | null }
    const money = (v: number) => `$${fmtCost(v)}`
    const pct = (v: number) => `${Math.floor(v)}%`
    const whole = (v: number) => fmtNum(Math.round(v))
    const rate = (v: number) => (v < 10 ? v.toFixed(1) : fmtNum(Math.round(v)))
    const table = (heads: string[], metrics: Metric[], footer: string): RowItem[][] => [
      [label(heads[0] ?? ''), ...heads.slice(1).map(h => cell(h, icons))],
      ...metrics.map(m => {
        const reference = m.values.slice(1).reverse().find(v => v !== null) ?? null
        return [
          label(m.name),
          ...m.values.map((v, i) => cell(v === null ? '—' : m.show(v), i === 0 ? judge(v, reference, m.better) : icons)),
        ]
      }),
      [note(footer)],
    ]
    const sessions = new Set(history.map(t => t.session)).size
    const footer = history.length
      ? `7-day avg covers ${history.length} ${history.length === 1 ? 'turn' : 'turns'} in ${sessions} ${sessions === 1 ? 'session' : 'sessions'}`
      : 'the 7-day column fills as you work'

    if (panel === 'calls' || panel === 'callLines') {
      if (!current) return [[label('Last turn'), note('no turns yet')]]
      const now = turnAverages([current])
      const here = turnAverages(sessionTurns)
      const week = turnAverages(history)
      const row = (name: string, pick: (a: Averages) => number | null, show: (v: number) => string, better: Metric['better']): Metric => ({
        name,
        values: [pick(now), pick(here), history.length ? pick(week) : null],
        show,
        better,
      })
      const heads = ['Last turn', 'this turn', 'session avg', '7-day avg']
      if (panel === 'calls') {
        return table(
          heads,
          [
            row('Calls', a => a.calls, rate, null),
            row('Cost', a => a.cost, money, 'lower'),
            row('Cost per 1M tok', a => a.costPerMTok, money, 'lower'),
            row('Cache hit', a => a.cacheHit, pct, 'higher'),
            row('Tokens/s', a => a.tps, whole, 'higher'),
            row('Output', a => a.output, whole, null),
          ],
          footer,
        )
      }
      const linesText = (a: Averages) => (a.linesAdded === null || a.linesRemoved === null ? null : a.linesAdded + a.linesRemoved)
      return table(
        heads,
        [
          {
            name: 'Lines changed',
            values: [now, here, history.length ? week : null].map(a => (a ? linesText(a) : null)),
            show: whole,
            better: null,
          },
          row('Lines/min', a => a.linesPerMin, rate, 'higher'),
          row('Cost per line', a => a.costPerLine, money, 'lower'),
          row('Files touched', a => a.files, rate, null),
        ],
        footer,
      )
    }

    if (sessionTurns.length === 0) return [[label('Session'), note('no turns yet')]]
    const totals = sessionTotals(sessionTurns, view.sessionCostUsd)
    const others = otherSessionAverages(history, sid)
    const pair = (name: string, pick: (s: SessionTotals) => number | null, show: (v: number) => string, better: Metric['better']): Metric => ({
      name,
      values: [pick(totals), others ? pick(others) : null],
      show,
      better,
    })
    const heads = ['Session', 'this session', '7-day avg/session']
    const sessionFooter = others ? footer : 'the 7-day column fills as other sessions finish turns'
    if (panel === 'totals') {
      return table(
        heads,
        [
          pair('Turns', s => s.turns, whole, null),
          pair('Calls', s => s.calls, whole, null),
          pair('Tokens sent', s => s.tokens, whole, null),
          pair('Cache hit', s => s.cacheHit, pct, 'higher'),
          pair('Tokens/s', s => s.tps, whole, 'higher'),
          pair('Cost', s => s.cost, money, null),
          pair('Cost per turn', s => s.costPerTurn, money, 'lower'),
        ],
        sessionFooter,
      )
    }
    return table(
      heads,
      [
        pair('Lines changed', s => s.linesAdded + s.linesRemoved, whole, null),
        pair('Lines/min', s => s.linesPerMin, rate, 'higher'),
        pair('Cost per line', s => s.costPerLine, money, 'lower'),
      ],
      sessionFooter,
    )
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
      notes[0] = colored(`peak ${fmtNum(Math.max(0, ...known.map(d => d.tokens)))} a day`, tokensColor)
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
      [host.sessionName ? { ...value(host.sessionName), pick: 'name', link: true } : value('unnamed'), note('·'), value(host.sessionId ?? '')],
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
