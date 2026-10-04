import { describe, expect, test } from 'claude-code/testing'

import { barChart, lineChart } from '../hooks/charts'
import { dayKey, mergeLedger, parseLedger, serializeLedger, summarize, type Ledger } from '../hooks/ledger'
import { readConfig } from '../hooks/format'
import { CHART_HEIGHT, MIDDLE_WIDTH, ROW_GAP, TITLE_WIDTH, panelLines, type PanelView, type RowItem } from '../hooks/panels'

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

describe('chart rows', () => {
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
    ...over,
  })
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
  const calls = Array.from({ length: 12 }, (_, i) => ({ at: i, tokens: (i + 1) * 1000, costUsd: (i + 1) / 100 }))

  test('calls, totals and usage draw a chart in the middle column with notes after it', () => {
    for (const panel of ['calls', 'totals', 'usage'] as const) {
      const lines = panelLines(panel, view({ callLog: calls }))
      expect(lines).toHaveLength(CHART_HEIGHT)
      for (const line of lines) {
        expect(columns(line)[1]).toBe(TITLE_WIDTH + ROW_GAP)
        const chartWidth = line.filter((item, i) => i > 0 && (i === 1 || item.tight)).reduce((sum, item) => sum + item.text.length, 0)
        expect(chartWidth).toBe(MIDDLE_WIDTH)
      }
    }
  })

  test('the calls row shows the last ten calls and their peaks', () => {
    const lines = panelLines('calls', view({ callLog: calls }))
    expect(lines[0]?.[0]?.text).toBe('Calls')
    expect(lines[0]?.at(-1)?.text).toBe('▲ 12k tokens')
    expect(lines[1]?.at(-1)?.text).toBe('▲ $0.12')
    expect(lines.at(-1)?.at(-1)?.text).toBe('last 10 calls')
  })

  test('the totals row sums the session', () => {
    const lines = panelLines('totals', view({ callLog: calls }))
    expect(lines[0]?.at(-1)?.text).toBe('78k tokens')
    expect(lines[1]?.at(-1)?.text).toBe('$0.78')
    expect(lines.at(-1)?.at(-1)?.text).toBe('12 calls this session')
  })

  test('the usage row says when nothing is recorded, and since when otherwise', () => {
    expect(panelLines('usage', view({})).at(-1)?.at(-1)?.text).toBe('no usage recorded yet')
    const usage = summarize({ '2026-10-04': { a: { tokens: 2_000_000, costStart: 0, costEnd: 3 } } }, '2026-10-04', 30)
    const lines = panelLines('usage', view({ usage }))
    expect(lines.map(l => l.at(-1)?.text)).toContain('all time 2.0M · $3.00')
    expect(lines.at(-1)?.at(-1)?.text).toBe('since 2026-10-04')
  })

  test('with no calls yet the line charts say so', () => {
    expect(panelLines('calls', view({})).at(-1)?.at(-1)?.text).toBe('no calls yet')
  })
})
