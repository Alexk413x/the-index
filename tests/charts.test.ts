import { describe, expect, test } from 'claude-code/testing'

import { barChart, lineChart, markerRow } from '../hooks/charts'
import { HISTORY_MS, mergeTurns, otherSessionAverages, parseTurns, serializeTurns, turnAverages } from '../hooks/turns'
import type { IndexTurnRecord } from '../types'
import { dayKey, mergeLedger, parseLedger, serializeLedger, summarize, type Ledger } from '../hooks/ledger'
import { isFix, parseCommitLog, parseMergedPrs } from '../hooks/git'
import { readConfig } from '../hooks/format'
import {
  CHART_HEIGHT,
  MIDDLE_WIDTH,
  ROW_GAP,
  TITLE_WIDTH,
  GIT_LINES_HALF,
  groupTurns,
  panelLines,
  turnRecord,
  type PanelView,
  type RowItem,
} from '../hooks/panels'

const text = (line: readonly RowItem[]) => line.map(i => i.text).join('')
const BLANK = '#808080'

describe('line chart', () => {
  test('a rising line runs from the bottom left dot to the top right dot', () => {
    const lines = lineChart([{ values: [0, 10], color: '#ff0000' }], 2, 2, BLANK)
    expect(text(lines[1] ?? []).charCodeAt(0) & 0x40).toBe(0x40)
    expect(text(lines[0] ?? []).charCodeAt(1) & 0x08).toBe(0x08)
  })

  test('every row is exactly the chart width, and later cells sit flush', () => {
    const lines = lineChart([{ values: [1, 5, 2, 8, 3], color: '#ff0000' }], 30, 4, BLANK)
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(text(line)).toHaveLength(30)
      expect(line[0]?.tight).toBeUndefined()
      expect(line.slice(1).every(i => i.tight)).toBe(true)
    }
  })

  test('no values draw a blank chart', () => {
    expect(lineChart([{ values: [], color: '#ff0000' }], 5, 2, BLANK).map(text)).toEqual(['     ', '     '])
  })

  test('the first series colours a cell both series cross', () => {
    const lines = lineChart(
      [
        { values: [3, 3], color: '#ff0000' },
        { values: [3, 3], color: '#0000ff' },
      ],
      3,
      1,
      BLANK,
    )
    expect(lines[0]?.every(i => i.color === '#ff0000')).toBe(true)
  })
})

describe('fixed scale and markers', () => {
  test('a ceiling scales a series to it instead of its own peak', () => {
    const half = lineChart([{ values: [20, 20], color: '#ff0000', max: 100 }], 2, 2, BLANK)
    expect(text(half[0] ?? []).trim()).toBe('')
    expect(text(half[1] ?? []).trim()).not.toBe('')
  })

  test('markers sit under the points they mark', () => {
    expect(text(markerRow(3, [0, 2], 5, '▲', '#ff0000', BLANK))).toBe('▲   ▲')
    expect(text(markerRow(0, [], 3, '▲', '#ff0000', BLANK))).toBe('   ')
  })
})

describe('commit log', () => {
  test('numstat rows add up per commit, binary files count as files with no lines', () => {
    const text = [
      '@aaa\t1700000000\tAdd charts',
      '10\t2\ta.ts',
      '-\t-\timg.png',
      ' create mode 100644 img.png',
      '',
      '@bbb\t1690000000\tFix\ttabs',
      '1\t1\tb.ts',
      '0\t9\told.ts',
      ' delete mode 100644 old.ts',
    ].join('\n')
    expect(parseCommitLog(text)).toEqual([
      { sha: 'aaa', at: 1_700_000_000_000, subject: 'Add charts', added: 10, removed: 2, files: 2, filesAdded: 1, filesDeleted: 0 },
      { sha: 'bbb', at: 1_690_000_000_000, subject: 'Fix\ttabs', added: 1, removed: 10, files: 2, filesAdded: 0, filesDeleted: 1 },
    ])
    expect(parseCommitLog('')).toEqual([])
  })

  test('the commits row plots oldest to newest and names the base branch', () => {
    const baseCommits = parseCommitLog(['@b\t2\tSecond', '30\t5\ta.ts', '1\t0\tb.ts', '@a\t1\tFirst', '4\t1\ta.ts'].join('\n'))
    const lines = panelLines('base', view({ baseCommits }))
    const labelled = (title: string) => lines.findIndex(l => l[0]?.text.trim() === title)
    expect(lines.flat().some(i => i.text.startsWith('last '))).toBe(false)
    expect(labelled('Lines')).toBe(0)
    expect(labelled('Files')).toBe(GIT_LINES_HALF * 2 + 1 + 1)
    expect(lines[labelled('Files') - 1]?.map(i => i.text.trim()).join('')).toBe('')
    const notes = lines.map(l => l.at(-1)?.text)
    expect(notes).toContain('+35 lines added')
    expect(notes).toContain('-6 lines removed')
    expect(notes).toContain('~3 files modified')
    expect(lines.at(-1)?.at(-1)).toMatchObject({ text: 'hover a bar for its commit', footer: true })
    expect(lines.flat().find(i => i.hoverId === 'commit-b')?.detail).toBe('Second · +31 -5 · files +0 ~2 -0')
    const cfg = readConfig({})
    expect(lines.flat().some(i => i.hoverId === 'commit-b' && i.color === cfg.colors.bad && i.text.trim())).toBe(true)
    expect(lines.flat().some(i => i.hoverId === 'commit-b' && i.color === cfg.colors.warn)).toBe(true)
  })

  test('the commits row lists the open PRs into the base as buttons after the branch link', () => {
    const basePrs = [
      { number: 42, title: 'Add charts', url: 'https://github.com/acme/app/pull/42', branch: 'feat/x' },
      { number: 43, title: 'A very long pull request title that runs on', url: 'https://github.com/acme/app/pull/43', branch: 'feat/y' },
    ]
    const links = { base: { label: 'View PR #42', url: 'https://github.com/acme/app/pull/42' } }
    const actions = panelLines('base', view({ basePrs, links }))[0]?.filter(i => i.pick) ?? []
    expect(actions.map(i => [i.text, i.pick])).toEqual([
      ['View PR #42 ↗', 'https://github.com/acme/app/pull/42'],
      ['#43 A very long pull reques… ↗', 'https://github.com/acme/app/pull/43'],
    ])
    const many = Array.from({ length: 8 }, (_, i) => ({ number: i, title: 'Fix the thing', url: `https://github.com/acme/app/pull/${i}`, branch: `b${i}` }))
    const lines = panelLines('base', view({ basePrs: many }))
    expect(lines.length).toBeGreaterThan(CHART_HEIGHT + 1)
    expect(lines.slice(0, lines.length - CHART_HEIGHT).flat().filter(i => i.pick)).toHaveLength(8)
  })

  test('fix subjects read as fixes, other subjects do not', () => {
    for (const subject of ['Fix the tooltip', 'fix: overlap', 'Hotfix login', 'Revert "Add x"', 'bugfix(ui): y']) expect(isFix(subject)).toBe(true)
    for (const subject of ['Add charts', 'Prefix names', 'Refactor fixtures']) expect(isFix(subject)).toBe(false)
  })

  test('the branch row bars each commit ahead of the base, marks fixes, and gives the pace', () => {
    const branchCommits = parseCommitLog(
      ['@c3\t10800\tFix overlap', '2\t30\ta.ts', '@c2\t3600\tAdd hover', '40\t5\ta.ts', '1\t0\tb.ts', '@c1\t0\tStart charts', '100\t0\tc.ts'].join('\n'),
    )
    const lines = panelLines('branch', view({ branchCommits, links: { branch: 'https://github.com/a/b/tree/x' } }))
    expect(lines[0]?.map(i => i.text.trim())).toEqual(['Branch', 'View branch ↗'])
    const notes = lines.map(l => l.at(-1)?.text)
    expect(notes).toContain('+143 lines added')
    expect(notes).toContain('-35 lines removed')
    expect(notes).toContain('avg 1h30m between commits')
    expect(notes).toContain('1 of 3 commits are fixes (33%)')
    const fixRow = lines.find(l => l[0]?.text.trim() === 'Fix?') ?? []
    expect(fixRow.filter(i => i.text.includes('×')).map(i => i.hoverId)).toEqual(['commit-c3'])
    expect(lines.flat().find(i => i.hoverId === 'commit-c2')?.detail).toBe('Add hover · +41 -5 · 2 files · 1h0m after the previous')
    expect(panelLines('branch', view({})).flat().some(i => i.text === 'no commits ahead of origin/main')).toBe(true)
  })

  test('merged PRs read from gh JSON with their size, commits and time open', () => {
    const prs = parseMergedPrs([
      {
        number: 8,
        title: 'Hover rows',
        url: 'https://github.com/a/b/pull/8',
        additions: 310,
        deletions: 45,
        changedFiles: 6,
        createdAt: '2026-10-01T10:00:00Z',
        mergedAt: '2026-10-01T15:06:00Z',
        commits: [{}, {}, {}],
      },
      { number: 9, url: 'u', createdAt: 'nope', mergedAt: 'nope' },
    ])
    expect(prs).toEqual([
      { number: 8, title: 'Hover rows', url: 'https://github.com/a/b/pull/8', added: 310, removed: 45, files: 6, commits: 3, openedAt: Date.parse('2026-10-01T10:00:00Z'), mergedAt: Date.parse('2026-10-01T15:06:00Z') },
    ])
  })

  test('the PRs row bars size and time to merge per merged PR, marks fixes, and gives medians', () => {
    const pr = (number: number, title: string, added: number, removed: number, hours: number) => ({
      number,
      title,
      url: `https://github.com/a/b/pull/${number}`,
      added,
      removed,
      files: 2,
      commits: 2,
      openedAt: 0,
      mergedAt: hours * 3_600_000,
    })
    const mergedPrs = [pr(3, 'Fix crash', 10, 4, 1), pr(2, 'Add band', 300, 50, 6), pr(1, 'Start', 100, 0, 2)]
    const lines = panelLines('base', view({ mergedPrs, links: { base: { label: 'Create PR', url: 'https://github.com/a/b/compare/x' } } }))
    expect(lines.map(l => l[0]?.text.trim())).toEqual(['PRs', 'Size', 'Merge', 'Fix?', ''])
    const notes = lines.map(l => l.at(-1)?.text)
    expect(notes).toContain('median +100 -4 per PR')
    expect(notes).toContain('median 2h0m to merge')
    expect(notes).toContain('1 of 3 PRs are fixes (33%)')
    expect(lines.flat().find(i => i.hoverId === 'pr-2')?.detail).toBe('#2 Add band · +300 -50 · 2 commits · 6h0m open')
    expect(lines[0]?.filter(i => i.pick).map(i => i.text)).toEqual(['Create PR ↗'])
  })
})

describe('turns', () => {
  const call = (turnId: string, at: number, costUsd: number | null, files: string[] = []) => ({
    at,
    turnId,
    tokens: 1000,
    input: 900,
    cacheRead: 800,
    output: 100,
    apiMs: 1000,
    costUsd,
    linesAdded: 3,
    linesRemoved: 1,
    files,
  })

  test('calls group into turns with their files, and an unknown cost makes the turn unknown', () => {
    const turns = groupTurns([call('a', 1000, 0.1, ['x.ts']), call('a', 3000, 0.2, ['x.ts', 'y.ts']), call('b', 5000, null), call('b', 6000, 0.1)])
    expect(turns.map(t => [t.id, t.tokens, t.costUsd, t.files.size, t.linesAdded])).toEqual([
      ['a', 2000, 0.30000000000000004, 2, 6],
      ['b', 2000, null, 0, 6],
    ])
    expect(turnRecord(turns[0]!, 's1')).toMatchObject({ id: 'a', session: 's1', at: 3000, spanMs: 3000, files: 2 })
    const old = { at: 0, tokens: 5, costUsd: 0.1 } as unknown as Parameters<typeof groupTurns>[0][number]
    expect(groupTurns([old, call('c', 1, 0.1)]).map(t => t.id)).toEqual(['c'])
  })
})

const round = (v: number | null | undefined) => (v === null || v === undefined ? v : Number(v.toFixed(6)))

describe('turn history', () => {
  const record = (id: string, session: string, at: number, over: Partial<IndexTurnRecord> = {}): IndexTurnRecord => ({
    id,
    session,
    at,
    tokens: 2000,
    input: 1800,
    cacheRead: 900,
    output: 200,
    apiMs: 2000,
    spanMs: 60_000,
    costUsd: 0.1,
    linesAdded: 10,
    linesRemoved: 0,
    files: 1,
    ...over,
  })

  test('the file keeps other sessions, replaces this one, and drops turns older than 7 days', () => {
    const now = 10 * 86_400_000
    const disk = [record('o1', 'other', now - 1000), record('old', 'other', now - HISTORY_MS - 1), record('m1', 'me', now - 5000)]
    const merged = mergeTurns(disk, 'me', [record('m2', 'me', now - 100)], now)
    expect(merged.map(t => t.id)).toEqual(['o1', 'm2'])
    expect(parseTurns(JSON.parse(serializeTurns(merged)))).toEqual(merged)
    expect(parseTurns({ version: 1, turns: [{ id: 'x', session: 's', at: 'nope' }] })).toEqual([])
    expect(parseTurns({ version: 2, turns: [] })).toEqual([])
  })

  test('averages take cost per token and cache hit from sums, tokens per second per turn', () => {
    const a = turnAverages([record('a', 's', 0), record('b', 's', 1, { costUsd: 0.3, tokens: 6000, input: 6000, cacheRead: 6000, apiMs: 1000 })])
    expect(round(a.cost)).toBe(round(0.2))
    expect(round(a.costPerMTok)).toBe(round(50))
    expect(round(a.cacheHit)).toBe(round(((900 + 6000) / (1800 + 6000)) * 100))
    expect(round(a.tps)).toBe(round((100 + 200) / 2))
    expect(round(a.linesPerMin)).toBe(round(10))
    expect(turnAverages([]).cost).toBeNull()
  })

  test('other sessions average their totals per session', () => {
    const history = [record('a', 'one', 0), record('b', 'one', 1), record('c', 'two', 2, { costUsd: 0.4 }), record('m', 'me', 3)]
    const others = otherSessionAverages(history, 'me')
    expect(others?.turns).toBe(1.5)
    expect(round(others?.costPerTurn)).toBe(round((0.1 + 0.4) / 2))
    expect(otherSessionAverages([record('m', 'me', 0)], 'me')).toBeNull()
  })
})

describe('bar chart', () => {
  test('bars scale to the tallest day in eighths, and a day with no data shows a dot', () => {
    const lines = barChart([8, 4, null, 0], 2, 1, '#ff0000', BLANK)
    expect(text(lines[0] ?? [])).toBe('█ ▄ ·   ')
    const tall = barChart([16, 4], 1, 2, '#ff0000', BLANK)
    expect(tall.map(text)).toEqual(['█ ', '█▄'])
  })
})

describe('usage ledger', () => {
  const day = dayKey(new Date(2026, 9, 4, 12).getTime())

  test('day keys use the local date', () => {
    expect(day).toBe('2026-10-04')
  })

  test('a merge writes this session and keeps every other session', () => {
    const disk = parseLedger({ version: 1, days: { [day]: { other: { tokens: 5, costStart: 0, costEnd: 1 } } } })
    const merged = mergeLedger(disk, 'me', { [day]: { tokens: 7, costStart: 2, costEnd: 3 } })
    expect(merged[day]).toEqual({ other: { tokens: 5, costStart: 0, costEnd: 1 }, me: { tokens: 7, costStart: 2, costEnd: 3 } })
    expect(parseLedger(JSON.parse(serializeLedger(merged)))).toEqual(merged)
  })

  test('a malformed or foreign file reads as empty', () => {
    expect(parseLedger({ version: 2, days: {} })).toEqual({})
    expect(parseLedger({ version: 1, days: { nope: {}, '2026-10-01': { s: { tokens: 'x' } } } })).toEqual({})
    expect(parseLedger(undefined)).toEqual({})
  })

  test('the summary sums sessions per day, fills the window and counts all time', () => {
    const ledger: Ledger = {
      '2026-08-01': { a: { tokens: 100, costStart: 0, costEnd: 1 } },
      '2026-10-03': { a: { tokens: 10, costStart: 1, costEnd: 1.5 }, b: { tokens: 5, costStart: null, costEnd: 2 } },
      [day]: { a: { tokens: 20, costStart: 1.5, costEnd: 2 } },
    }
    const summary = summarize(ledger, day, 3)
    expect(summary.since).toBe('2026-08-01')
    expect(summary.days).toEqual([
      { date: '2026-10-02', tokens: 0, costUsd: null },
      { date: '2026-10-03', tokens: 15, costUsd: 0.5 },
      { date: day, tokens: 20, costUsd: 0.5 },
    ])
    expect(summary.allTokens).toBe(135)
    expect(summary.allCostUsd).toBe(2)
  })
})

const view = (over: Partial<PanelView>): PanelView => ({
    cfg: readConfig({}),
    choices: { model: '', effort: undefined, modelIsDefault: true, effortIsDefault: true },
    harnesses: null,
    ultracode: false,
    contextTokens: null,
    host: null,
    startedAt: null,
    attached: 0,
    callLog: [],
    usage: null,
    contextLog: [],
    contextLimit: null,
    baseCommits: [],
    baseRef: 'origin/main',
    branchCommits: [],
    mergedPrs: [],
    turnHistory: [],
    links: {},
    basePrs: [],
    cacheLeftMs: null,
    now: 0,
    ...over,
  })

describe('chart rows', () => {
  const columns = (line: readonly RowItem[]) => {
    const starts: number[] = []
    let col = 0
    line.forEach((item, i) => {
      if (i > 0 && !item.tight) col += ROW_GAP
      starts.push(col)
      col += item.text.length + (item.pad ?? 0)
    })
    return starts
  }
  const calls = Array.from({ length: 12 }, (_, i) => ({
    at: i,
    turnId: `t${Math.floor(i / 2)}`,
    tokens: (i + 1) * 1000,
    input: (i + 1) * 900,
    cacheRead: (i + 1) * 450,
    output: (i + 1) * 100,
    apiMs: 1000,
    costUsd: ((i % 3) + 1) / 100,
    cacheWrite: (i + 1) * 100,
    linesAdded: (i % 4) * 10,
    linesRemoved: (i % 2) * 5,
  }))

  const history: IndexTurnRecord[] = [
    { id: 'h1', session: 'me', at: 100, tokens: 4000, input: 3600, cacheRead: 1800, output: 200, apiMs: 4000, spanMs: 4000, costUsd: 0.08, linesAdded: 20, linesRemoved: 0, files: 1 },
    { id: 'o1', session: 'other', at: 50, tokens: 2000, input: 1800, cacheRead: 1700, output: 100, apiMs: 1000, spanMs: 1000, costUsd: 0.1, linesAdded: 0, linesRemoved: 0, files: 0 },
    { id: 'o2', session: 'other', at: 60, tokens: 2000, input: 1800, cacheRead: 1700, output: 100, apiMs: 1000, spanMs: 1000, costUsd: 0.1, linesAdded: 0, linesRemoved: 0, files: 0 },
  ]
  const liveCalls = [
    { at: 1000, turnId: 'live', tokens: 1000, input: 900, cacheRead: 800, output: 100, apiMs: 1000, costUsd: 0.02, linesAdded: 10, linesRemoved: 0, files: ['a.ts'] },
    { at: 2000, turnId: 'live', tokens: 1000, input: 900, cacheRead: 850, output: 100, apiMs: 1000, costUsd: 0.02, linesAdded: 0, linesRemoved: 5, files: ['a.ts', 'b.ts'] },
  ]
  const card = (panel: 'calls' | 'callLines' | 'totals' | 'totalLines') =>
    panelLines(panel, view({ callLog: liveCalls, turnHistory: history, host: { sessionName: '', sessionId: 'me', bridged: false, ide: '', agent: '', project: '' } }))
  const cellsOf = (line: readonly RowItem[] | undefined) => (line ?? []).map(i => i.text.trim())
  const cfg = readConfig({})

  test('the last turn card compares this turn with the session and the last 7 days', () => {
    const lines = card('calls')
    expect(cellsOf(lines[0])).toEqual(['Last turn', 'this turn', 'session avg', '7-day avg'])
    expect(lines.map(l => l[0]?.text.trim())).toEqual(['Last turn', 'Cost', 'Cost per 1M tok', 'Cache hit', 'Tokens/s', 'Output', '7-day avg covers 3 turns in 2 sessions'])
    expect(cellsOf(lines[1])).toEqual(['Cost', '$0.04', '$0.06', '$0.09'])
    expect(lines[1]?.[1]?.color).toBe(cfg.colors.good)
    expect(cellsOf(lines[3])).toEqual(['Cache hit', '91%', expect.any(String), '72%'])
    expect(lines[3]?.[1]?.color).toBe(cfg.colors.good)
    expect(lines.at(-1)?.at(-1)?.text).toBe('7-day avg covers 3 turns in 2 sessions')
  })

  test("the turn's code card gives lines, pace, cost per line and files", () => {
    const lines = card('callLines')
    expect(cellsOf(lines[1])).toEqual(['Lines changed', '15', '18', '7'])
    expect(cellsOf(lines[2])).toEqual(['Lines/min', '450', expect.any(String), expect.any(String)])
    expect(cellsOf(lines[3])).toEqual(['Cost per line', '$0.0027', expect.any(String), expect.any(String)])
    expect(cellsOf(lines[4])).toEqual(['Files touched', '2.0', '1.5', '0.3'])
  })

  test('the session cards compare this session with the average other session', () => {
    const lines = card('totals')
    expect(cellsOf(lines[0])).toEqual(['Session', 'this session', '7-day avg/session'])
    expect(cellsOf(lines[1])).toEqual(['Turns', '2', '2'])
    expect(cellsOf(lines[6])).toEqual(['Cost per turn', '$0.06', '$0.10'])
    expect(lines[6]?.[1]?.color).toBe(cfg.colors.good)
    const code = card('totalLines')
    expect(cellsOf(code[1])).toEqual(['Lines changed', '35', '0'])
    expect(cellsOf(code[2])).toEqual(['Lines/min', expect.any(String), '—'])
  })

  test('with no turns the cards say so, and without history the 7-day column waits', () => {
    expect(panelLines('calls', view({})).at(-1)?.at(-1)?.text).toBe('no turns yet')
    expect(panelLines('totals', view({})).at(-1)?.at(-1)?.text).toBe('no turns yet')
    const fresh = panelLines('calls', view({ callLog: liveCalls }))
    expect(cellsOf(fresh[1])).toEqual(['Cost', '$0.04', '$0.04', '—'])
    expect(fresh.at(-1)?.at(-1)?.text).toBe('the 7-day column fills as you work')
  })

  test('the usage row says when nothing is recorded, and since when otherwise', () => {
    expect(panelLines('usage', view({})).at(-1)?.at(-1)?.text).toBe('no usage recorded yet')
    const usage = summarize({ '2026-10-04': { a: { tokens: 2_000_000, costStart: 0, costEnd: 3 } } }, '2026-10-04', 30)
    const lines = panelLines('usage', view({ usage }))
    expect(lines.map(l => l.at(-1)?.text)).toContain('all time 2.0M · $3.00')
    expect(lines.at(-1)?.at(-1)?.text).toBe('since 2026-10-04')
  })

  test('the context row draws the threshold, the fill and the compactions', () => {
    const contextLog = [
      { at: 1, percent: 40, tokens: 80_000 },
      { at: 2, percent: 85, tokens: 170_000 },
      { at: 3, percent: 10, tokens: 20_000, compaction: 'auto' as const },
    ]
    const lines = panelLines('context', view({ contextLog, contextLimit: { window: 200_000, threshold: 167_000 } }))
    expect(lines).toHaveLength(CHART_HEIGHT)
    expect(lines.map(l => l.at(-1)?.text)).toEqual([
      '100% · 200k window',
      'compacts at 84%',
      'now 10% · 20k',
      'peak 85%',
      expect.any(String),
      '▲ 1 compaction',
    ])
    expect(panelLines('context', view({})).at(-1)?.at(-1)?.text).toBe('no readings yet')
    const warm = panelLines('context', view({ contextLog, cacheLeftMs: 42 * 60_000 }))
    expect(warm[4]?.at(-1)?.text).toBe('cache warm · 42m0s left')
    const cold = panelLines('context', view({ contextLog, cacheLeftMs: 0 }))
    expect(cold[4]?.at(-1)?.text).toBe('cache cold · next call re-reads it')
  })
})
