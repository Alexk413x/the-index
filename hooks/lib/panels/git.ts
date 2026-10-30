import type { IndexCommit, IndexPanel } from '../../../types'
import { columnBars, markColumns, splitBars, stackedBars, type SplitBar, type StackedBar } from '../charts'
import { SYM_FILES, SYM_LINES, fmtDur, fmtNum } from '../format'
import { isFix } from '../git'
import type { DetailPart, PanelView, RowItem } from '../panels'
import { GIT_LINES_HALF, MIDDLE_WIDTH } from './constants'
import type { Kit } from './kit'

const GIT_FILES_HEIGHT = 3
const COMMIT_SLOTS = 10
const BRANCH_SLOTS = 20
const PR_TITLE_MAX = 24

function padSlots<T>(list: readonly T[], slots: number): (T | null)[] {
  return [...list, ...Array<null>(Math.max(0, slots - list.length)).fill(null)]
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function gitHelpers(view: PanelView, kit: Kit) {
  const { cfg } = view
  const { note, title, blankTitle, chartRows, colored } = kit
  const action = (text: string, url: string): RowItem => ({ text: `${text} ↗`, color: cfg.colors.branch, pick: url, link: true })
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
  return { action, baseActions, gitRows, fileParts, fileText, split, commitParts, partsOf, fileNotesFor, fixMark, fixShare }
}

type Helpers = ReturnType<typeof gitHelpers>

function mergedPrLines(view: PanelView, kit: Kit, helpers: Helpers): RowItem[][] {
  const { cfg } = view
  const { note, title, blankTitle, chartRows, colored, tokensColor } = kit
  const { baseActions, fixMark, fixShare } = helpers
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

function commitLines(view: PanelView, kit: Kit, helpers: Helpers): RowItem[][] {
  const { cfg } = view
  const { title } = kit
  const { baseActions, gitRows, fileParts, fileText, split, commitParts, partsOf, fixMark, fixShare } = helpers
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

function branchLines(view: PanelView, kit: Kit, helpers: Helpers): RowItem[][] {
  const { cfg } = view
  const { note, title, blankTitle, colored } = kit
  const { action, fileParts, split, commitParts, partsOf, fileNotesFor, fixMark, fixShare } = helpers
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

export function gitLines(panel: IndexPanel, view: PanelView, kit: Kit): RowItem[][] {
  const helpers = gitHelpers(view, kit)
  if (panel === 'branch') return branchLines(view, kit, helpers)
  return view.mergedPrs.length > 0 ? mergedPrLines(view, kit, helpers) : commitLines(view, kit, helpers)
}
