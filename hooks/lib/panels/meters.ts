import type { IndexPanel } from '../../../types'
import { barChart, bucketReadings, lineChart } from '../charts'
import { categoryLabel, fmtClock, fmtCost, fmtDur, fmtNum, fmtPercent, fmtStamp } from '../format'
import type { PanelView, RowItem } from '../panels'
import { otherSessionAverages, sessionTotals, turnAverages, turnToRecord, type Averages, type SessionTotals } from '../turns'
import { CHART_HEIGHT, CONTEXT_PICK, DETAIL_PICK, MIDDLE_WIDTH, TITLE_WIDTH, USAGE_DAYS } from './constants'
import { padTo, type Kit } from './kit'

const CONTEXT_CATEGORIES = ['System prompt', 'System tools', 'MCP tools', 'Custom agents', 'Memory files', 'Skills', 'Messages'] as const
const CARD_LABEL = 18
const CARD_COLUMN = 14
const CONTEXT_STEP = 4
// None is orange: the Total line owns that colour.
const CONTEXT_COLORS = ['#00afd7', '#5faf5f', '#d7d700', '#af5fd7', '#5f87ff', '#ff5faf', '#00d7af', '#c80000', '#afafff', '#87afaf']

function contextLines(view: PanelView, kit: Kit): RowItem[][] {
  const { cfg } = view
  const { note, title, blankTitle, colored, tokensColor } = kit
  const log = view.contextLog
  const limit = view.contextLimit
  const windowSize = limit?.window ?? 0
  const latest = log.filter(p => p.parts).at(-1)?.parts
  const names = [...CONTEXT_CATEGORIES, ...Object.keys(latest ?? {}).filter(n => !(CONTEXT_CATEGORIES as readonly string[]).includes(n))]
  const colorOf = (name: string) => CONTEXT_COLORS[names.indexOf(name) % CONTEXT_COLORS.length] ?? cfg.colors.icons
  const selected = view.contextSeries !== null && names.includes(view.contextSeries) ? view.contextSeries : null
  const points = selected === null ? log : log.filter(p => p.parts)
  const share = (tokens: number) => fmtPercent(windowSize > 0 ? (tokens / windowSize) * 100 : 0)
  const mean = (list: readonly number[]) => list.reduce((sum, v) => sum + v, 0) / list.length
  const compactions = log.filter(p => p.compaction).length
  const thresholdPct = limit?.threshold ? Math.min(100, (limit.threshold / limit.window) * 100) : null
  const first = log[0]
  const last = log[log.length - 1]
  const start = first ? Math.min(view.startedAt ?? first.at, first.at) : 0
  const end = last?.at ?? start

  const dotColumns = MIDDLE_WIDTH * 2
  const buckets = bucketReadings(points.map(p => p.compaction !== undefined), dotColumns, CONTEXT_STEP)
  const grouped = buckets.map(b => {
    const members = b.indexes.flatMap(i => (points[i] ? [points[i]] : []))
    const tokens = members.flatMap(m => (m.tokens === null ? [] : [m.tokens]))
    const parts: Record<string, number> = {}
    for (const name of names) {
      const seen = members.flatMap(m => (m.parts?.[name] === undefined ? [] : [m.parts[name]]))
      if (seen.length) parts[name] = mean(seen)
    }
    return {
      column: b.column,
      count: members.length,
      at: members[members.length - 1]?.at ?? start,
      percent: mean(members.map(m => m.percent)),
      tokens: tokens.length ? mean(tokens) : null,
      parts,
    }
  })
  const values = grouped.map(g => (selected === null ? g.percent : windowSize > 0 ? ((g.parts[selected] ?? 0) / windowSize) * 100 : 0))

  const tags = grouped.map((g, i) => ({ id: `context-${i}`, detail: `${fmtClock(g.at)}${g.count > 1 ? ` (avg of ${g.count})` : ''}` }))

  type Side = { text: string; color: string; pick?: string }
  const sideFor = (percent: number, tokens: number | null, parts: Readonly<Record<string, number>> | undefined): { rows: Side[]; baseline: string } => {
    const mark = (on: boolean) => (on ? '▸ ' : '  ')
    const total: Side = {
      text: `${mark(selected === null)}Total ${fmtPercent(percent)}${tokens === null ? '' : ` · ${fmtNum(Math.round(tokens))}`}`,
      color: tokensColor,
      ...(selected === null ? {} : { pick: CONTEXT_PICK }),
    }
    const seen = names.map((name): [string, number] => [name, parts?.[name] ?? 0])
    const baseline = seen.filter(([name]) => name !== 'Messages').reduce((sum, [, t]) => sum + t, 0)
    return {
      baseline: `Baseline ${share(baseline)} · ${fmtNum(Math.round(baseline))} before any prompt`,
      rows: [
      total,
      ...seen
        .sort((x, y) => y[1] - x[1])
        .map(([name, t]): Side => ({
          text: `${mark(selected === name)}${categoryLabel(name)} ${share(t)} · ${fmtNum(Math.round(t))}`,
          color: colorOf(name),
          ...(selected === name ? {} : { pick: `${CONTEXT_PICK}${name}` }),
        })),
      ],
    }
  }
  const current = last ? sideFor(last.percent, last.tokens, latest) : sideFor(0, 0, undefined)
  const sides = grouped.map(g => sideFor(g.percent, g.tokens, g.parts))
  // A hovered column swaps in other text; every variant pads to the longest so the row keeps its width.
  const swapping = (side: Side, swapped: (s: ReturnType<typeof sideFor>) => Side | undefined): RowItem => {
    const variants = sides.map((s, i): [string, Side] => [`context-${i}`, swapped(s) ?? { text: '', color: cfg.colors.icons }])
    const width = Math.max(side.text.length, ...variants.map(([, v]) => v.text.length))
    return {
      ...side,
      text: side.text.padEnd(width),
      swaps: Object.fromEntries(variants.map(([id, v]) => [id, { text: v.text.padEnd(width), color: v.color }])),
    }
  }
  const entries: RowItem[] = current.rows.map((side, slot) => swapping(side, s => s.rows[slot]))
  const baselineItem: RowItem[] = current.baseline ? [swapping({ text: current.baseline, color: cfg.colors.icons }, s => ({ text: s.baseline, color: cfg.colors.icons }))] : []
  const hint = 'hover a column for its time and values'

  const header: RowItem[] = [
    note(limit ? `100% · ${fmtNum(limit.window)} window` : '100%'),
    ...(thresholdPct !== null ? [colored(`compacts at ${Math.round(thresholdPct)}%`, cfg.colors.warn)] : []),
    colored(`💥x${compactions}`, compactions > 0 ? cfg.colors.high : cfg.colors.icons),
    ...(view.cacheLeftMs === null
      ? []
      : [
          view.cacheLeftMs > 0
            ? colored(`cache warm · ${fmtDur(view.cacheLeftMs / 1000)} left`, cfg.colors.good)
            : colored('cache cold · next call re-reads it', cfg.colors.cold),
        ]),
  ]
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString()
  const stamp = (ms: number) => (sameDay ? fmtClock(ms) : fmtStamp(ms))
  const axis = Array.from({ length: MIDDLE_WIDTH }, () => ' ')
  const put = (at: number, label: string) => label.split('').forEach((ch, i) => void (axis[at + i] = ch))
  if (last) {
    const endStamp = stamp(end)
    const startAt = Math.max(4, Math.floor((grouped[0]?.column ?? 0) / 2))
    put(0, '0%')
    if (startAt + stamp(start).length + 2 <= MIDDLE_WIDTH - endStamp.length) put(startAt, stamp(start))
    put(MIDDLE_WIDTH - endStamp.length, endStamp)
  } else {
    put(0, '0%  no readings yet')
  }
  const bottom = note(axis.join(''))

  const chartHeight = CHART_HEIGHT + 3
  const columns = grouped.map(g => g.column)
  const body: RowItem[][] = [
    padTo(header, MIDDLE_WIDTH),
    ...lineChart([{ values, color: selected === null ? tokensColor : colorOf(selected), max: 100 }], MIDDLE_WIDTH, chartHeight, cfg.colors.icons, tags, columns),
    [bottom],
  ]
  return [
    ...body.map((row, r) => {
      const side = entries[r - 1]
      const left =
        r === 0
          ? title('Context')
          : r === Math.floor(body.length / 2)
            ? { text: 'Details', color: cfg.colors.branch, pick: DETAIL_PICK, link: true, pad: TITLE_WIDTH - 7, detail: 'click to open the detailed breakdown' }
            : blankTitle()
      return [left, ...row, ...(side ? [side] : [])]
    }),
    [blankTitle(), { text: hint, color: cfg.colors.icons, footer: true, pad: MIDDLE_WIDTH - hint.length }, ...baselineItem],
  ]
}

function cardLines(panel: IndexPanel, view: PanelView, kit: Kit): RowItem[][] {
  const { cfg } = view
  const { note } = kit
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

function usageLines(view: PanelView, kit: Kit): RowItem[][] {
  const { cfg } = view
  const { note, blankTitle, chartRows, colored, tokensColor } = kit
  const usage = view.usage
  const days = usage?.days ?? []
  const values = usage ? days.map(d => (usage.since && d.date >= usage.since ? d.tokens : null)) : Array<null>(USAGE_DAYS).fill(null)
  const tags = days.map((d, i) =>
    values[i] === null
      ? null
      : { id: `usage-${d.date}`, detail: `${d.date} · ${fmtNum(d.tokens)} tokens${d.costUsd === null ? '' : ` · $${fmtCost(d.costUsd)}`}` },
  )
  const chart = barChart(values, Math.max(1, Math.floor(MIDDLE_WIDTH / USAGE_DAYS)), CHART_HEIGHT, tokensColor, cfg.colors.icons, tags)
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
  return [
    ...chartRows('Usage', chart, notes),
    ...(usage?.since ? [[blankTitle(), { text: 'hover a day for its tokens', color: cfg.colors.icons, footer: true }]] : []),
  ]
}

export function meterLines(panel: IndexPanel, view: PanelView, kit: Kit): RowItem[][] {
  if (panel === 'context') return contextLines(view, kit)
  if (panel === 'usage') return usageLines(view, kit)
  return cardLines(panel, view, kit)
}
