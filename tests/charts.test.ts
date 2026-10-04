import { describe, expect, test } from 'claude-code/testing'

import { barChart, divergingBars, lineChart, markerRow } from '../hooks/charts'
import { dayKey, mergeLedger, parseLedger, serializeLedger, summarize, type Ledger } from '../hooks/ledger'
import { parseCommitLog } from '../hooks/git'
import { readConfig } from '../hooks/format'
import {
  CHART_HEIGHT,
  MIDDLE_WIDTH,
  ROW_GAP,
  TITLE_WIDTH,
  TURN_HALF,
  groupTurns,
  panelLines,
  turnDetail,
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
    const text = ['@aaa\t1700000000\tAdd charts', '10\t2\ta.ts', '-\t-\timg.png', '', '@bbb\t1690000000\tFix\ttabs', '1\t1\tb.ts'].join('\n')
    expect(parseCommitLog(text)).toEqual([
      { sha: 'aaa', at: 1_700_000_000_000, subject: 'Add charts', added: 10, removed: 2, files: 2 },
      { sha: 'bbb', at: 1_690_000_000_000, subject: 'Fix\ttabs', added: 1, removed: 1, files: 1 },
    ])
    expect(parseCommitLog('')).toEqual([])
  })

  test('the commits row plots oldest to newest and names the base branch', () => {
    const baseCommits = parseCommitLog(['@b\t2\tSecond', '30\t5\ta.ts', '1\t0\tb.ts', '@a\t1\tFirst', '4\t1\ta.ts'].join('\n'))
    const lines = panelLines('base', view({ baseCommits }))
    expect(lines.map(l => l.at(-1)?.text)).toEqual(['▲ +31 lines', '▲ -5 lines', '▲ 2 files', 'Second', expect.any(String), 'last 2 commits to origin/main'])
  })

  test('the changes row plots the working tree since the last commit, with its rate', () => {
    const worktree = {
      head: 'abc',
      since: 0,
      points: [
        { at: 1_800_000, added: 40, removed: 10, files: 2 },
        { at: 3_600_000, added: 120, removed: 30, files: 5 },
      ],
    }
    const lines = panelLines('branch', view({ worktree, now: 7_200_000 }))
    expect(lines.map(l => l.at(-1)?.text)).toEqual(['+120 lines', '-30 lines', '5 files', '75 lines an hour', expect.any(String), '2h0m since the last commit'])
    expect(panelLines('branch', view({})).at(-1)?.at(-1)?.text).toBe('no commit yet')
  })
})

describe('turns and diverging bars', () => {
  const call = (turnId: string, tokens: number, costUsd: number | null) => ({
    at: 0,
    turnId,
    tokens,
    input: tokens,
    cacheRead: 0,
    output: 0,
    apiMs: 0,
    costUsd,
  })

  test('calls group into turns in order, and an unknown cost makes the turn unknown', () => {
    const turns = groupTurns([call('a', 10, 0.1), call('a', 5, 0.2), call('b', 7, null), call('b', 1, 0.1)])
    expect(turns.map(t => [t.id, t.number, t.tokens, t.costUsd])).toEqual([
      ['a', 1, 15, 0.30000000000000004],
      ['b', 2, 8, null],
    ])
    expect(turnDetail(turns[1]!)).toBe('turn 2 · 8 tokens · 0% cache · ↓0')
  })

  test('a bar above the average rises in the above colour, one below falls in the below colour', () => {
    const colors = { above: '#ff0000', below: '#00ff00', axis: '#888888', blank: '#000000' }
    const rows = divergingBars(
      [
        { id: 'hi', value: 3, detail: 'hi' },
        { id: 'lo', value: 1, detail: 'lo' },
        { id: 'mid', value: 2, detail: 'mid' },
      ],
      2,
      3,
      1,
      1,
      colors,
    )
    expect(rows.map(r => r.map(i => i.text).join(''))).toEqual(['█     ', '──────', '  █   '])
    expect(rows[0]?.find(i => i.hoverId === 'hi')?.color).toBe('#ff0000')
    expect(rows[2]?.find(i => i.hoverId === 'lo')?.color).toBe('#00ff00')
    expect(rows[1]?.find(i => i.hoverId === 'mid')?.detail).toBe('mid')
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
    worktree: null,
    links: {},
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
  }))

  test('calls, totals and usage draw a chart in the middle column with notes after it', () => {
    for (const panel of ['calls', 'totals', 'usage'] as const) {
      const lines = panelLines(panel, view({ callLog: calls }))
      const chartLines = panel === 'calls' ? lines.slice(0, TURN_HALF * 2 + 1) : lines
      expect(chartLines).toHaveLength(panel === 'calls' ? TURN_HALF * 2 + 1 : CHART_HEIGHT)
      for (const line of chartLines) {
        expect(columns(line)[1]).toBe(TITLE_WIDTH + ROW_GAP)
        const chartWidth = line.filter((item, i) => i > 0 && (i === 1 || item.tight)).reduce((sum, item) => sum + item.text.length, 0)
        expect(chartWidth).toBe(MIDDLE_WIDTH)
      }
    }
  })

  test('the cost per token row bars each turn against the session average, with a footer for the hovered turn', () => {
    const lines = panelLines('calls', view({ callLog: calls }))
    const cfg = readConfig({})
    expect(lines).toHaveLength(TURN_HALF * 2 + 2)
    expect(lines[0]?.[0]?.text).toBe('Cost/tok')
    expect(lines[0]?.at(-1)?.text).toBe('▲ dearer per token')
    expect(lines[TURN_HALF]?.at(-1)?.text).toMatch(/^avg \$\d+\.\d\d\/M tokens$/)
    expect(lines[TURN_HALF * 2]?.at(-1)?.text).toBe('▼ cheaper per token')
    const footer = lines.at(-1)?.at(-1)
    expect(footer).toMatchObject({ text: 'hover a bar for its turn · last 6 of 6', footer: true })
    const cells = lines.slice(0, TURN_HALF * 2 + 1).flat()
    expect(cells.some(i => i.color === cfg.colors.bad && i.hoverId)).toBe(true)
    expect(cells.some(i => i.color === cfg.colors.good && i.hoverId)).toBe(true)
    expect(cells.find(i => i.hoverId === 'turn-t0')?.detail).toMatch(/^turn 1 · 3\.0k tokens · \$0\.03 · \$10\.00\/M · 50% cache · ↓300 · 150 tok\/s$/)
  })

  test('the totals row sums the session', () => {
    const lines = panelLines('totals', view({ callLog: calls }))
    expect(lines[0]?.at(-1)?.text).toBe('78k tokens')
    expect(lines[1]?.at(-1)?.text).toBe('$0.24')
    expect(lines.at(-1)?.at(-1)?.text).toBe('12 calls this session')
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

  test('with no calls yet the charts say so', () => {
    expect(panelLines('calls', view({})).at(-1)?.at(-1)?.text).toBe('no turns yet')
    expect(panelLines('totals', view({})).at(-1)?.at(-1)?.text).toBe('no calls yet')
  })
})
