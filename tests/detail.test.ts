import { expect, test } from 'claude-code/testing'

import type { IndexCallPoint, IndexContextDetail, IndexContextPoint, IndexTurnRecord, IndexUsageSummary } from '../types'
import { DETAIL_BAR, DETAIL_PERCENT, TURN_TITLES, callKind, cellWidths, tableHeadLine, tableParts, tableTitles, isIdle, columnTitles, percentText, detailRows, headKey, headLine, isCollapsed, isUserPrompt, rowKey, markdownRows, mcpSections, rowParts, centered, splitMax, titledHead, toContextDetail, valueWidthOf, visibleRows, sectionBlocks, splitCount, turnDayKey, type DetailView } from '../hooks/lib/detail'

const CONTEXT: IndexContextDetail = {
  window: 200_000,
  total: 60_000,
  categories: [
    { name: 'System prompt', tokens: 4000, deferred: false },
    { name: 'Messages', tokens: 30_000, deferred: false },
    { name: 'MCP tools (deferred)', tokens: 9000, deferred: true },
  ],
  memoryFiles: [
    { path: 'C:\\Users\\a\\.claude\\CLAUDE.md', type: 'User', tokens: 800 },
    { path: 'C:/work/app/.claude/CLAUDE.md', type: 'Project', tokens: 1200 },
  ],
  mcpTools: [
    { name: 'mcp__github__get_me', server: 'github', tokens: 300, loaded: true },
    { name: 'mcp__github__list_issues', server: 'github', tokens: 500, loaded: true },
    { name: 'mcp__slack__send', server: 'slack', tokens: 900, loaded: false },
  ],
  skills: [{ name: 'init', source: 'built-in', tokens: 50 }],
  agents: [{ type: 'Explore', source: 'built-in', tokens: 120 }],
}

const CALL = (at: number, tokens: number): IndexCallPoint => ({
  at,
  turnId: `t${at}`,
  tokens,
  input: tokens - 100,
  cacheRead: 0,
  output: 100,
  apiMs: 1500,
  costUsd: 0.05,
})

const TURN = (id: string, session: string, at: number, tokens: number): IndexTurnRecord => ({
  id,
  session,
  at,
  tokens,
  input: tokens,
  cacheRead: 0,
  output: 0,
  apiMs: 1000,
  spanMs: 4000,
  costUsd: 0.1,
  linesAdded: 3,
  linesRemoved: 1,
  files: 1,
})

const USAGE: IndexUsageSummary = {
  days: [
    { date: '2026-10-19', tokens: 1000, costUsd: 0.5 },
    { date: '2026-10-20', tokens: 0, costUsd: null },
    { date: '2026-10-21', tokens: 3000, costUsd: 1.5 },
  ],
  allTokens: 9000,
  allCostUsd: 4,
  since: '2026-09-01',
}

const view = (over: Partial<DetailView> = {}): DetailView => ({
  contextDetail: CONTEXT,
  callLog: [],
  turnHistory: [],
  usage: null,
  session: 's1',
  ...over,
})

test('the context tab sums each section and sorts its items by size', () => {
  const rows = detailRows('context', view())
  const labels = rows.map(r => `${r.kind}:${r.label}=${r.value}`)
  expect(labels).toContain('head:Context window · 200k=60k')
  expect(labels).toContain('item:Prompts (0) · 0 turns · 0 calls · 0s=30k')
  expect(labels).toContain('item:System Prompt=4.0k')
  expect(labels.some(l => l.startsWith('head:Categories'))).toBe(false)
  expect(labels.some(l => l.startsWith('head:Memory Files') && l.endsWith('=2.0k'))).toBe(true)
  expect(labels).toContain('head:Memory Files (2)=2.0k')
  expect(labels.indexOf('item:CLAUDE.md  Project  app/.claude=1.2k')).toBeLessThan(labels.indexOf('item:CLAUDE.md  User     a/.claude=800'))
  expect(labels).toContain('head:Skills (1)=50')
  expect(labels).toContain('head:Agents (1)=120')
})

test('the Context window summary is a fixed row that never collapses', () => {
  const rows = detailRows('context', view())
  expect(rows.find(r => r.label === 'Context window · 200k')).toMatchObject({ kind: 'head', value: '60k', fixed: true })
  expect(visibleRows(rows, ['Context window · 200k']).map(r => r.label)).toContain('Memory Files (2)')
  expect(visibleRows(rows, ['Context window · 200k']).some(r => r.label === 'Context window · 200k')).toBe(true)
})

test('a divider row follows the Context window summary', () => {
  const rows = detailRows('context', view())
  const at = rows.findIndex(r => r.label === 'Context window · 200k')
  expect(rows[at + 1]).toMatchObject({ kind: 'note', divider: true })
  expect(visibleRows(rows, [])[visibleRows(rows, []).findIndex(r => r.label === 'Context window · 200k') + 1]?.divider).toBe(true)
})

test('deferred categories stay out of the category sum, and deferred MCP tools out of the MCP sum', () => {
  const rows = detailRows('context', view())
  expect(rows.some(r => r.label === 'MCP tools (deferred)')).toBe(false)
  expect(rows.find(r => r.label === 'MCP Tools (3)')).toMatchObject({ value: '800 / 1.7k', max: ' / 1.7k' })
  const slack = rows.find(r => r.label === 'send')
  expect(slack).toMatchObject({ value: '900', indent: 1, dim: true, share: 0 })
})

test('MCP tools group under their server with the server prefix stripped', () => {
  const rows = detailRows('context', view())
  const at = (label: string) => rows.findIndex(r => r.label === label)
  expect(at('github (2)')).toBeLessThan(at('list_issues'))
  expect(at('list_issues')).toBeLessThan(at('get_me'))
  expect(at('get_me')).toBeLessThan(at('slack (1)'))
})

test('the context tab shows a note before the breakdown is read', () => {
  expect(detailRows('context', view({ contextDetail: null }))).toEqual([
    { kind: 'note', label: 'The context breakdown has not been read yet.', value: '', share: null, indent: 0 },
  ])
})

test('the turns tab lists this session newest first, each turn with its calls under it', () => {
  const calls = [
    { ...CALL(1_800_000_001_000, 1000), turnId: 'a' },
    { ...CALL(1_800_000_002_000, 3000), turnId: 'a' },
    { ...CALL(1_800_000_021_000, 500), turnId: 'c' },
  ]
  const rows = detailRows(
    'turns',
    view({
      callLog: calls,
      turnHistory: [TURN('a', 's1', 1_800_000_000_000, 2000), TURN('b', 's2', 1_800_000_010_000, 9000), TURN('c', 's1', 1_800_000_020_000, 4000)],
    }),
  )
  expect(rows[0]).toMatchObject({ kind: 'head', fixed: true })
  expect(rows[0]?.label).toBe('Prompts 0 · Turns 2 · Calls 0')
  expect(rows[0]?.titles).toEqual(TURN_TITLES)
  expect(rows[0]?.cells).toEqual(['8s', '6.0k', '6.0k', '0', '+6 -2', '$0.20'])
  expect(rows.map(r => r.kind)).toEqual(['head', 'note', 'sub', 'sub', 'sub', 'item', 'sub', 'item', 'item'])
  expect(rows[1]).toMatchObject({ divider: true })
  expect(rows[2]).toMatchObject({ count: 2, cells: rows[0]?.cells })
  expect(rows[2]?.closed).toBeUndefined()
  expect(rows[2]?.key).toBe(turnDayKey(rows[2]?.label ?? ''))
  expect(rows[3]).toMatchObject({ label: 'Model not recorded', count: 2, depth: 1, under: [rows[2]?.key] })
  expect(rows[4]).toMatchObject({ key: 'c', depth: 2, count: 0, closed: true, under: [rows[2]?.key, rows[3]?.key] })
  expect(rows[4]?.cells).toEqual(['4s', '4.0k', '4.0k', '0', '+3 -1', '$0.10'])
  expect(rows[5]).toMatchObject({ depth: 3, under: [rows[2]?.key, rows[3]?.key, 'c'] })
  expect(rows[5]?.cells?.slice(1, 4)).toEqual(['500', '400', '100'])
  expect(rows[7]?.cells?.[1]).toBe('1.0k')
  expect(rows[8]?.cells?.[1]).toBe('3.0k')
  const modelled = detailRows('turns', view({ turnHistory: [{ ...TURN('m', 's1', 1_800_000_000_000, 2000), model: 'claude-fable-5-2', effort: 'high' }, { ...TURN('old', 's1', 1_800_000_000_000 - 3 * 86_400_000, 2000), model: 'claude-fable-5-2', effort: 'low' }] }))
  expect(modelled.filter(r => r.depth === 1).map(r => r.label)).toEqual(['main · Fable 5.2 · high', 'main · Fable 5.2 · low'])
  expect(modelled.filter(r => r.depth === undefined && r.kind === 'sub').map(r => r.closed)).toEqual([undefined, true])
  expect(modelled.find(r => r.key === 'm')?.kind).toBe('item')
  expect(visibleRows(modelled, []).map(r => r.key).filter(Boolean)).toHaveLength(4)
})

test('calls of a turn with no finished record still list under a turn row built from them', () => {
  const rows = detailRows(
    'turns',
    view({
      callLog: [
        { ...CALL(1_800_000_001_000, 1000), turnId: 'live' },
        { ...CALL(1_800_000_002_000, 3000), turnId: 'live' },
      ],
    }),
  )
  expect(rows.map(r => r.kind)).toEqual(['head', 'note', 'sub', 'sub', 'sub', 'item', 'item'])
  expect(rows[0]?.label).toBe('Prompts 0 · Turns 1 · Calls 2')
  expect(rows[4]).toMatchObject({ key: 'live', count: 2 })
  expect(rows[4]?.cells?.[1]).toBe('4.0k')
})

test('a call is labelled by the tools it runs, MCP tools by server, and the first call as the prompt', () => {
  expect(callKind(0, [])).toBe('Prompt → Answer')
  expect(callKind(0, ['Read'])).toBe('Prompt → Read')
  expect(callKind(2, ['Edit', 'Edit', 'mcp__github__get_me'])).toBe('Edit ×2, github:get_me')
  expect(callKind(3, [])).toBe('Answer')
  const rows = detailRows('turns', view({ callLog: [{ ...CALL(1_800_000_001_000, 1000), turnId: 'a', kind: 'Prompt → Read' }], turnHistory: [TURN('a', 's1', 1_800_000_000_000, 2000)] }))
  expect(rows[5]?.label.endsWith(' Prompt → Read')).toBe(true)
})

test('a turn starts closed, opens when listed, and the Turns head never collapses', () => {
  const rows = detailRows(
    'turns',
    view({ callLog: [{ ...CALL(1_800_000_001_000, 1000), turnId: 'a' }], turnHistory: [TURN('a', 's1', 1_800_000_000_000, 2000)] }),
  )
  const turn = rows.find(r => r.key === 'a')!
  const key = rowKey(turn)
  expect(visibleRows(rows, []).map(r => r.kind)).toEqual(['head', 'note', 'sub', 'sub', 'sub'])
  expect(visibleRows(rows, [key]).map(r => r.kind)).toEqual(['head', 'note', 'sub', 'sub', 'sub', 'item'])
  expect(visibleRows(rows, ['Turns', key]).map(r => r.kind)).toEqual(['head', 'note', 'sub', 'sub', 'sub', 'item'])
  expect(visibleRows(rows, [key, rowKey(rows[3]!)]).map(r => r.kind)).toEqual(['head', 'note', 'sub', 'sub'])
  expect(visibleRows(rows, [key, rowKey(rows[2]!)]).map(r => r.kind)).toEqual(['head', 'note', 'sub'])
})

test('the turns table sizes each column to its widest cell or title, and every row lines up', () => {
  const rows = detailRows(
    'turns',
    view({ callLog: [{ ...CALL(1_800_000_001_000, 1000), turnId: 'a', costUsd: null }], turnHistory: [TURN('a', 's1', 1_800_000_000_000, 2000)] }),
  )
  const widths = cellWidths(rows)
  expect(widths).toHaveLength(TURN_TITLES.length - 1)
  expect(widths[0]).toBeGreaterThanOrEqual('Time'.length)
  const lines = rows.filter(r => r.cells).map(r => (r.kind === 'head' ? tableHeadLine(r, 60, widths) : (() => { const p = tableParts(r, 60, widths); return p.label + p.tail })()))
  expect(new Set(lines.map(l => l.length)).size).toBe(1)
  expect(tableTitles(rows[0]!, 60, widths)).toHaveLength(lines[0]!.length)
  expect(tableTitles(rows[0]!, 60, widths).startsWith(`   ${TURN_TITLES[0]}`)).toBe(true)
  expect(tableHeadLine(rows[0]!, 60, widths).startsWith(' Prompts 0 · Turns')).toBe(true)
  expect(rows[5]?.cells?.at(-1)).toBe('░')
  expect(tableParts(rows[4]!, 60, widths, '▸').label.startsWith('     ▸ ')).toBe(true)
})

test('the usage tab lists days with tokens, newest first, and the all-time note', () => {
  const rows = detailRows('usage', view({ usage: USAGE }))
  expect(rows[0]).toMatchObject({ label: 'Last 3 days', value: '4.0k · $2.00', fixed: true })
  expect(rows[1]).toMatchObject({ kind: 'head', label: 'All time since 2026-09-01', value: '9.0k · $4.00', fixed: true })
  expect(rows[2]).toMatchObject({ kind: 'note', label: '' })
  expect(rows.filter(r => r.kind === 'item')).toEqual([])
  const week = { days: 7, tokens: 3000, costUsd: 1.5, models: [] }
  const heads = detailRows('usage', view({ usage: { ...USAGE, week } })).filter(r => r.kind === 'head')
  expect(heads[0]).toMatchObject({ label: 'Last 7 days', value: '3.0k · $1.50', fixed: true })
  expect(heads.map(r => r.label)).toEqual(['Last 7 days', 'Last 3 days', 'All time since 2026-09-01'])
})

test('empty tabs show a note', () => {
  expect(detailRows('turns', view())[0]?.kind).toBe('note')
  expect(detailRows('usage', view())[0]?.kind).toBe('note')
})

test('a row keeps its value on the right edge and truncates a long label', () => {
  const row = { kind: 'item' as const, label: 'a-very-long-memory-file-name.md · Project', value: '1.2k', share: 0.5, indent: 1 as const }
  const parts = rowParts(row, 40)
  expect(parts.label.length + parts.bar.length + 1 + parts.percent.length + 1 + parts.value.length + 1).toBe(40)
  expect(parts.label.endsWith('…')).toBe(true)
  expect(parts.bar).toBe('█'.repeat(DETAIL_BAR / 2).padStart(DETAIL_BAR))
  expect(parts.edge).toBe(-1)
})

test('a small share still draws one cell, and no share draws none', () => {
  const tiny = rowParts({ kind: 'item', label: 'x', value: '1', share: 0.001, indent: 0 }, 30)
  expect(tiny.bar).toBe('▏'.padStart(DETAIL_BAR))
  expect(tiny.edge).toBe(DETAIL_BAR - 1)
  expect(rowParts({ kind: 'item', label: 'x', value: '1', share: null, indent: 0 }, 30).bar).toBe(' '.repeat(DETAIL_BAR))
})

test('bars grow from the right edge in eighths of a cell, the partial cell drawn inverse', () => {
  const parts = (share: number) => rowParts({ kind: 'item', label: 'x', value: '1', share, indent: 0 }, 30)
  expect(parts(0.5).bar).toBe('    ████')
  expect(parts(0.5 + 1 / 16).bar).toBe('   ▌████')
  expect(parts(0.5 + 1 / 16).edge).toBe(3)
  expect(parts(1).bar).toBe('█'.repeat(DETAIL_BAR))
  expect(parts(1).edge).toBe(-1)
})

test('rows with different value lengths start their bars and values in the same columns', () => {
  const rows = [
    { kind: 'item' as const, label: 'short', value: '5', share: 0.2, indent: 0 as const },
    { kind: 'item' as const, label: 'longer name', value: '1.2k deferred', share: null, indent: 1 as const },
    { kind: 'item' as const, label: 'x', value: '30.5k', share: 1, indent: 0 as const },
  ]
  const valueWidth = Math.max(...rows.map(r => r.value.length))
  const lines = rows.map(r => {
    const p = rowParts(r, 50, valueWidth)
    return p.label + p.bar + ' ' + p.percent + ' ' + p.value
  })
  expect(new Set(lines.map(l => l.length)).size).toBe(1)
  const parts = rows.map(r => rowParts(r, 50, valueWidth))
  expect(new Set(parts.map(p => p.label.length)).size).toBe(1)
  expect(parts.every(p => p.value.length === valueWidth)).toBe(true)
})

test('toContextDetail keeps used and deferred rows and drops free space and the buffer', () => {
  const detail = toContextDetail({
    totalTokens: 100,
    maxTokens: 1000,
    categories: [
      { name: 'Messages', tokens: 60, isDeferred: false, kind: 'used' },
      { name: 'Free space', tokens: 900, isDeferred: false, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 40, isDeferred: false, kind: 'buffer' },
      { name: 'MCP tools (deferred)', tokens: 20, isDeferred: true, kind: 'deferred' },
    ],
    memoryFiles: [],
    mcpTools: [{ name: 'mcp__a__b', serverName: 'a', tokens: 5, isLoaded: false }],
    agents: [{ agentType: 'Plan', source: 'built-in', tokens: 7 }],
  })
  expect(detail.window).toBe(1000)
  expect(detail.categories.map(c => c.name)).toEqual(['Messages', 'MCP tools (deferred)'])
  expect(detail.mcpTools).toEqual([{ name: 'mcp__a__b', server: 'a', tokens: 5, loaded: false }])
  expect(detail.skills).toEqual([])
  expect(detail.agents).toEqual([{ type: 'Plan', source: 'built-in', tokens: 7 }])
})

test('a head draws its arrow, title and value, then dashes to the full width', () => {
  const rows = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' })
  const memory = rows.find(r => r.kind === 'head' && r.label === 'Memory Files (2)')
  expect(memory).toBeDefined()
  const open = headLine(memory!, 50, false, 6, false)
  expect(open.startsWith(' ▾ Memory Files · 2 ')).toBe(true)
  expect(splitCount(open, memory!)).toEqual([' ▾ Memory Files', open.slice(' ▾ Memory Files'.length)])
  expect(open.includes('─')).toBe(false)
  expect(open).toHaveLength(49)
  expect(open.endsWith('2.0k    1.0%')).toBe(true)
  expect(headLine(memory!, 50, true, 6, false).startsWith(' ▸ Memory Files')).toBe(true)
  const ruler = headLine(rows.find(r => r.fixed)!, 40, false)
  expect(ruler).toHaveLength(40)
  expect(ruler.includes('Context window')).toBe(true)
})

test('a collapsed head hides its rows up to the next head, and the key ignores the count', () => {
  const rows = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' })
  expect(headKey('MCP Tools (3)')).toBe('MCP Tools')
  expect(headKey('Context window · 200k')).toBe('Context window · 200k')
  const open = ['mcp-server:github', 'mcp-server:slack']
  const all = visibleRows(rows, open)
  expect(all.filter(r => r.label !== '')).toHaveLength(rows.filter(r => r.label !== '').length)
  const folded = visibleRows(rows, [...open, 'Memory Files'])
  expect(folded.some(r => r.label.startsWith('CLAUDE.md'))).toBe(false)
  expect(folded.some(r => r.kind === 'head' && r.label === 'Memory Files (2)')).toBe(true)
  expect(folded.some(r => r.label === 'System Prompt')).toBe(true)
  expect(folded.some(r => r.label === 'get_me')).toBe(true)
  expect(visibleRows([{ kind: 'note', label: 'nothing yet', value: '', share: null, indent: 0 }], ['Memory Files'])).toHaveLength(1)
})

test('an expanded head with items under it gets column titles as wide as its rows', () => {
  const rows = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' })
  const at = (label: string) => rows.findIndex(r => r.kind === 'head' && r.label === label)
  expect(titledHead(rows, at('Memory Files (2)'), [])).toEqual(['File       Type     Folder', 'Context', 'Tokens'])
  expect(titledHead(rows, at('Memory Files (2)'), ['Memory Files'])).toBeNull()
  expect(titledHead(rows, at('Context window · 200k'), [])).toBeNull()
  const valueWidth = valueWidthOf(rows)
  const sample = rows.find(r => r.kind === 'item')!
  const line = (() => {
    const p = rowParts(sample, 50, valueWidth)
    return `${p.label}${p.bar} ${p.percent} ${p.value}`
  })()
  expect(columnTitles(['File', 'Context', 'Tokens'], 50, valueWidth)).toHaveLength(line.length)
  expect(columnTitles(['File', 'Context', 'Tokens'], 50, valueWidth).startsWith('   File')).toBe(true)
  expect(columnTitles(['File', 'Context', 'Tokens'], 50, valueWidth).endsWith('Tokens')).toBe(true)
})

test('every context section names its columns', () => {
  const heads = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' }).filter(
    r => r.kind === 'head' && !r.fixed,
  )
  expect(heads.length).toBeGreaterThan(3)
  expect(heads.every(r => r.columns !== undefined)).toBe(true)
})

test('each MCP server is a sub-section that collapses its own tools', () => {
  const rows = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' })
  const subs = rows.filter(r => r.kind === 'sub')
  expect(subs.map(r => r.label)).toEqual(['github (2)', 'slack (1)'])
  expect(rows.filter(r => r.kind === 'item').some(r => r.label === 'get_me')).toBe(true)
  expect(subs.every(r => r.closed && isCollapsed(r, []))).toBe(true)
  expect(visibleRows(rows, []).some(r => r.label === 'get_me')).toBe(false)
  const spaced = visibleRows(rows, ['mcp-server:github', 'mcp-server:slack'])
  const slackAt = spaced.findIndex(r => r.kind === 'sub' && r.label === 'slack (1)')
  expect(spaced[slackAt - 1]).toMatchObject({ kind: 'note', label: '' })
  expect(spaced[slackAt - 2]?.kind).toBe('item')
  expect(spaced.filter(r => r.kind === 'note' && r.label === '' && !r.divider)).toHaveLength(5)
  const github = visibleRows(rows, ['mcp-server:slack'])
  expect(github.some(r => r.label === 'get_me')).toBe(false)
  expect(github.some(r => r.label === 'send')).toBe(true)
  expect(github.some(r => r.kind === 'sub' && r.label === 'github (2)')).toBe(true)
  const section = visibleRows(rows, ['MCP Tools'])
  expect(section.some(r => r.kind === 'sub')).toBe(false)
  expect(section.some(r => r.label === 'send')).toBe(false)
  expect(section.some(r => r.label === 'init')).toBe(true)
  expect(titledHead(rows, rows.findIndex(r => r.label.startsWith('MCP Tools')), [])).toEqual(['Server / Tool', 'Context', 'Tokens'])
})

test('every row names its share as text, even when the bar is empty', () => {
  expect(percentText(0.5)).toBe('    50%')
  expect(percentText(0.034)).toBe('   3.4%')
  expect(percentText(0.0004)).toBe('  <0.1%')
  expect(percentText(0)).toBe('     0%')
  expect(percentText(null)).toBe('      —')
  expect(percentText(1).length).toBe(DETAIL_PERCENT)
  const none = rowParts({ kind: 'item', label: 'x', value: '9k deferred', share: 0, indent: 1 }, 50)
  expect(none.bar.trim()).toBe('')
  expect(none.percent).toBe('     0%')
})

test('without bars a row reads label, value, then percentage, and the titles line up with it', () => {
  const rows = [
    { kind: 'item' as const, label: 'Messages', value: '30k', share: 0.15, indent: 0 as const },
    { kind: 'item' as const, label: 'System prompt', value: '4.0k', share: 0.02, indent: 0 as const },
  ]
  const valueWidth = 6
  const lines = rows.map(r => {
    const p = rowParts(r, 50, valueWidth, false)
    expect(p.bar).toBe('')
    expect(p.edge).toBe(-1)
    return p.label + p.tail
  })
  expect(lines[0]?.endsWith('30k     15%')).toBe(true)
  expect(lines[1]?.endsWith('4.0k    2.0%')).toBe(true)
  const titles = columnTitles(['File', 'Context', 'Tokens'], 50, valueWidth, false)
  expect(titles).toHaveLength(lines[0]?.length ?? -1)
  expect(titles.endsWith('Tokens Context')).toBe(true)
})

test('the Context tab titles its percentage column for the no-bar layout', () => {
  const rows = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' })
  expect(titledHead(rows, rows.findIndex(r => r.label === 'Memory Files (2)'), [])).toEqual(['File       Type     Folder', 'Context', 'Tokens'])
})

test('a head puts its total and share in the same columns as the rows under it', () => {
  const rows = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' })
  const categories = rows.find(r => r.kind === 'head' && r.label === 'Memory Files (2)')!
  const first = rows.find(r => r.kind === 'item')!
  const valueWidth = valueWidthOf(rows)
  const p = rowParts(first, 60, valueWidth, false)
  const itemLine = p.label + p.tail
  const headText = headLine(categories, 60, false, valueWidth, false)
  expect(headText).toHaveLength(itemLine.length)
  const valueEnd = (line: string, value: string) => line.lastIndexOf(value) + value.length
  expect(valueEnd(headText, categories.value)).toBe(valueEnd(itemLine, first.value))
  const barred = headLine(categories, 60, false, valueWidth, true)
  const barredItem = rowParts(first, 60, valueWidth, true)
  expect(barred).toHaveLength((barredItem.label + barredItem.bar + barredItem.tail).length)
})

test('deferred rows, and rows or heads that use no tokens, read as idle', () => {
  const rows = detailRows('context', { contextDetail: CONTEXT, callLog: [], turnHistory: [], usage: null, session: 's' })
  const find = (label: string) => rows.find(r => r.label === label)!
  expect(isIdle(find('send'))).toBe(true)
  expect(isIdle(find('get_me'))).toBe(false)
  expect(isIdle(find('Memory Files (2)'))).toBe(false)
  expect(isIdle(find('Context window · 200k'))).toBe(false)
  const empty = detailRows('context', { contextDetail: { ...CONTEXT, skills: [{ name: 'idle', source: 'built-in', tokens: 0 }] }, callLog: [], turnHistory: [], usage: null, session: 's' })
  expect(isIdle(empty.find(r => r.kind === 'head' && r.label.startsWith('Skills'))!)).toBe(true)
  expect(isIdle(empty.find(r => r.label === 'idle')!)).toBe(true)
  const slack = empty.find(r => r.kind === 'sub' && r.label.startsWith('slack'))!
  expect(isIdle(slack)).toBe(true)
  expect(isIdle(empty.find(r => r.kind === 'sub' && r.label.startsWith('github'))!)).toBe(false)
})

test('an MCP server row puts its active total in the token and percent columns, zero when all its tools are deferred', () => {
  const rows = detailRows('context', view())
  const github = rows.find(r => r.kind === 'sub' && r.label.startsWith('github'))!
  const slack = rows.find(r => r.kind === 'sub' && r.label.startsWith('slack'))!
  const valueWidth = valueWidthOf(rows)
  const g = rowParts({ ...github, label: '▾ github (2)' }, 60, valueWidth, false)
  const s = rowParts({ ...slack, label: '▾ slack (1)' }, 60, valueWidth, false)
  expect(g.tail.trim().startsWith(github.value)).toBe(true)
  expect(g.tail.endsWith(percentText(github.share))).toBe(true)
  expect(s.tail.trim().split(/\s+/)).toEqual(['0', '/', '900', '0%'])
  expect(slack.max).toBe(' / 900')
  expect(g.label + g.tail).toHaveLength((s.label + s.tail).length)
})
test('the maximum at the end of a value gets its own colour, wherever the value sits in the line', () => {
  const row = { kind: 'head' as const, label: 'MCP Tools (3)', value: '800 / 1.7k', max: ' / 1.7k', share: 0.01, indent: 0 as const }
  expect(splitMax(' ▸ MCP Tools (3)  800 / 1.7k    0.4% ', row, 'a', 'b')).toEqual([
    { text: ' ▸ MCP Tools (3)  800', color: 'a' },
    { text: ' / 1.7k', color: 'b' },
    { text: '    0.4% ', color: 'a' },
  ])
  expect(splitMax(' ▸ x ', { ...row, max: undefined }, 'a', 'b')).toEqual([{ text: ' ▸ x ', color: 'a' }])
})

test('markdown rows style headings and fenced code, bullet and wrap lines, and skip blanks', () => {
  const rows = markdownRows('## Issues\n\n- use list tools before search tools\n```\nx = 1\n```\nplain', 24, 1)
  expect(rows.map(r => [r.label.trim(), r.style])).toEqual([
    ['Issues', 'heading'],
    ['• use list tools', 'text'],
    ['before search', 'text'],
    ['tools', 'text'],
    ['x = 1', 'code'],
    ['plain', 'text'],
  ])
  expect(rows.every(r => r.kind === 'note' && r.indent === 1)).toBe(true)
})

test('the instructions split at connected-server headings, or at every ## when none names a server', () => {
  const text = '# MCP Server Instructions\n\nIntro line.\n\n## github\nAbcd\n## Issues\nEfgh\n\n## slack\nIj\n'
  const known = mcpSections(text, ['github', 'slack'])
  expect(known.intro.filter(Boolean)).toEqual(['Intro line.'])
  expect(known.sections.map(s => s.name)).toEqual(['github', 'slack'])
  expect(known.sections[0]!.lines).toContain('## Issues')
  expect(mcpSections(text, ['other']).sections.map(s => s.name)).toEqual(['github', 'Issues', 'slack'])
})

test('the MCP instructions and system prompt become heads whose sections start closed', () => {
  const text = '# MCP Server Instructions\n\n## github\nUse list tools.\n\n## slack\nBe brief.\n'
  const detail: IndexContextDetail = {
    ...CONTEXT,
    categories: [...CONTEXT.categories, { name: 'MCP server instructions', tokens: 600, deferred: false }, { name: 'System prompt', tokens: 400, deferred: false }],
    mcpInstructionsText: text,
    systemPromptSections: [{ id: 'communication', text: 'Be concise.' }],
  }
  const rows = detailRows('context', view({ contextDetail: detail }))
  const heads = rows.filter(r => r.kind === 'head').map(r => r.label)
  expect(heads).toContain('MCP Server Instructions (2)')
  expect(heads).toContain('System Prompt (1)')
  const subs = rows.filter(r => r.kind === 'sub' && r.closed && !r.key?.startsWith('mcp-server:'))
  expect(subs.map(r => r.label)).toEqual(['communication', 'github', 'slack'])
  expect(subs.every(r => isCollapsed(r, []))).toBe(true)
  expect(isCollapsed(subs[1]!, ['mcp-instructions:github'])).toBe(false)
  const shown = visibleRows(rows, ['mcp-instructions:github'])
  expect(shown.some(r => r.label.includes('Use list tools'))).toBe(true)
  expect(shown.some(r => r.label.includes('Be brief'))).toBe(false)
  expect(visibleRows(rows, ['MCP Server Instructions']).some(r => r.label.includes('Use list tools'))).toBe(false)
  const unread = detailRows('context', view({ contextDetail: { ...detail, mcpInstructionsText: null, mcpInstructionsNote: 'not found' } }))
  expect(unread.some(r => r.kind === 'note' && r.label.includes('not found'))).toBe(true)
})

test('an open section ends with an empty row before the next head, even when its last row is text', () => {
  const detail: IndexContextDetail = {
    ...CONTEXT,
    categories: [...CONTEXT.categories, { name: 'MCP server instructions', tokens: 600, deferred: false }],
    mcpInstructionsText: '# MCP Server Instructions\n\n## github\nUse list tools.\n',
  }
  const shown = visibleRows(detailRows('context', view({ contextDetail: detail })), ['MCP Server Instructions'].slice(1).concat('mcp-instructions:github'))
  const at = shown.findIndex(r => r.label.includes('Use list tools'))
  expect(at).toBeGreaterThan(-1)
  expect(shown[at + 1]).toMatchObject({ kind: 'note', label: '' })
  expect(shown[at + 2]?.kind).toBe('head')
})

test('the sentence before the first server heading becomes an Intro section with its own tokens', () => {
  const detail: IndexContextDetail = {
    ...CONTEXT,
    categories: [...CONTEXT.categories, { name: 'MCP server instructions', tokens: 600, deferred: false }],
    mcpInstructionsText: '# MCP Server Instructions\n\nThe following MCP servers have provided instructions:\n\n## github\nUse list tools.\n',
  }
  const subs = detailRows('context', view({ contextDetail: detail })).filter(r => r.kind === 'sub' && r.closed && !r.key?.startsWith('mcp-server:'))
  expect(subs.map(r => r.label)).toEqual(['Intro', 'github'])
  expect(subs[0]!.share).toBeGreaterThan(0)
})



test('the System Tools category becomes a head with one closed section per built-in tool, largest first', () => {
  const detail: IndexContextDetail = {
    ...CONTEXT,
    categories: [...CONTEXT.categories, { name: 'System tools', tokens: 900, deferred: false }],
    systemTools: [
      { name: 'Bash', description: 'Runs a command.\nLong detail follows.' },
      { name: 'Read', description: 'Reads a file from disk. Accepts line ranges.' },
    ],
  }
  const rows = detailRows('context', view({ contextDetail: detail }))
  const at = rows.findIndex(r => r.kind === 'head' && r.label === 'System Tools (2)')
  expect(at).toBeGreaterThan(-1)
  expect(rows[at]).toMatchObject({ value: '900' })
  const subs = rows.filter(r => r.kind === 'sub' && r.closed && r.key?.startsWith('system-tools:'))
  expect(subs.map(r => r.label)).toEqual(['Read', 'Bash'])
  expect(Number(subs[0]!.value)).toBeGreaterThan(Number(subs[1]!.value))
  const open = visibleRows(rows, ['system-tools:Bash'])
  expect(open.some(r => r.label.includes('Long detail follows'))).toBe(true)
  expect(open.some(r => r.label.includes('Accepts line ranges'))).toBe(false)
  expect(visibleRows(rows, ['System Tools']).some(r => r.label === 'Read')).toBe(false)
  expect(detailRows('context', view({ contextDetail: { ...detail, systemTools: [] } })).some(r => r.kind === 'item' && r.label === 'System Tools')).toBe(true)
})

test('the Prompts row in the Context tab counts prompts, then the session turns, calls and time', () => {
  const rows = detailRows('context', view({ prompts: 5, turnHistory: [TURN('a', 's1', 1_800_000_000_000, 2000), TURN('b', 's1', 1_800_000_100_000, 3000), TURN('c', 'other', 1_800_000_200_000, 1000)] }))
  const turns = rows.find(r => r.kind === 'item' && r.label.startsWith('Prompts ('))
  expect(turns?.label).toMatch(/^Prompts \(5\) · 2 turns · \d+ calls · /)
  expect(turns?.value).toBe('30k')
  expect(turns?.goto).toBe('turns')
  expect(rows.filter(r => r.goto).length).toBe(1)
})
test('the Context tab ends with a collapsible Compactions section, reading 0% until one happens', () => {
  const rows = (contextLog?: IndexContextPoint[]) => detailRows('context', view({ contextDetail: CONTEXT, ...(contextLog ? { contextLog } : {}) }))
  const none = rows()
  const at = none.findIndex(r => r.kind === 'head' && r.label === 'Compactions (0)')
  expect(at).toBeGreaterThan(-1)
  expect(at).toBe(none.length - 2)
  expect(none[0]).toMatchObject({ kind: 'head', label: 'Context window · 200k' })
  expect(none[at]).toMatchObject({ value: '', share: 0 })
  expect(none[at]?.fixed).toBeUndefined()
  expect(none[at + 1]?.label).toContain('No compactions')
  expect(visibleRows(none, ['Compactions']).some(r => r.label.includes('No compactions'))).toBe(false)
  expect(visibleRows(none, []).some(r => r.kind === 'head' && r.label === 'Memory Files (2)')).toBe(true)
  expect(visibleRows(none, []).filter(r => r.kind === 'item').length).toBe(visibleRows(none, ['Compactions']).filter(r => r.kind === 'item').length)
  const some = rows([{ at: 1_800_000_000_000, percent: 10, tokens: 20_000, compaction: 'auto' }])
  expect(some.some(r => r.kind === 'head' && r.label === 'Compactions (1)' && r.value === '')).toBe(true)
  expect(some[some.findIndex(r => r.label === 'Compactions (1)') + 1]?.label).toMatch(/auto -> 10% · 20k$/)
  const from = rows([
    { at: 1_799_999_000_000, percent: 87, tokens: 174_000 },
    { at: 1_800_000_000_000, percent: 10, tokens: 20_000, compaction: 'manual' },
  ])
  expect(from.some(r => r.kind === 'head' && r.label === 'Compactions (1)')).toBe(true)
  expect(from[from.findIndex(r => r.label === 'Compactions (1)') + 1]?.label).toMatch(/manual 87% · 174k -> 10% · 20k$/)
})

test('only the user\'s own submissions count as prompts', () => {
  expect(isUserPrompt('composer')).toBe(true)
  expect(isUserPrompt('bridge')).toBe(true)
  expect(isUserPrompt('composer', true)).toBe(false)
  for (const kind of ['scheduled-trigger', 'task-notification', 'peer', 'sdk', 'plugin', 'unclassified']) expect(isUserPrompt(kind)).toBe(false)
})

test('the usage tab lists each account limit with its reset, the surfaces and the model shares', () => {
  const now = 1_800_000_000_000
  const account = {
    fetchedAt: now,
    limits: [
      { kind: 'seven_day', label: 'Weekly', usedPercentage: 67, resetsAt: now + 3_600_000, severity: 'normal' },
      { kind: 'seven_day_fable', label: 'Fable', usedPercentage: 15.9, resetsAt: 0, severity: 'warning' },
    ],
    surfaces: [{ name: 'Chats', percent: 0 }, { name: 'Cowork', percent: 1 }, { name: 'Claude Code', percent: 99 }],
    shares: [{ label: 'Fable', usedPercent: 8, allowancePercent: 50 }],
    extraUsage: false,
  }
  const all = detailRows('usage', view({ account, now }))
  const rows = all.slice(all.findIndex(r => r.label === 'Weekly Stats'))
  expect(all[0]?.kind).toBe('note')
  expect(rows[0]).toMatchObject({ kind: 'head', label: 'Weekly Stats', side: 'Weekly 67% · Fable 15% warning · 1h', value: '' })
  expect(rows[0]?.fixed).toBeUndefined()
  expect(headLine(rows[0]!, 60, false)).toBe(` ▾ Weekly Stats ${'Weekly 67% · Fable 15% warning · 1h'.padStart(44)}`)
  expect(centered('ab', 6)).toBe('  ab  ')
  const apart = { ...account, limits: account.limits.map((l, n) => ({ ...l, resetsAt: now + (n + 1) * 90_300_000 })) }
  expect(detailRows('usage', view({ account: apart, now })).find(r => r.label === 'Weekly Stats')?.side).toBe('Weekly 67% (1d 1h 5m) · Fable 15% warning (2d 2h 10m)')
  expect(rows.filter(r => r.kind === 'head' && !r.fixed).map(r => r.label)).toEqual(['Weekly Stats'])
  const stats = rows.slice(rows.findIndex(r => r.label === 'Weekly Stats'))
  expect(stats.slice(1, 4).map(r => [r.kind, r.label])).toEqual([['item', 'Fable'], ['note', ''], ['item', 'Claude Code']])
  expect(rows.filter(r => ['Chats', 'Cowork', 'Claude Code'].includes(r.label)).map(r => [r.label, isIdle(r)])).toEqual([['Claude Code', false], ['Cowork', false], ['Chats', true]])
  expect(rows.find(r => r.label === 'Claude Code')).toMatchObject({ value: '', share: 0.99 })
  expect(rows.find(r => r.value === '8% · up to 50%')).toMatchObject({ label: 'Fable', share: 0.16 })
  expect(rows.at(-1)).toMatchObject({ label: 'Extra usage credits are off.', center: true })
  expect(detailRows('usage', view()).map(r => r.kind)).toEqual(['note', 'note'])
})

test('the usage tab folds a month over its days, a day over its sessions, and a session over its split', () => {
  const session = (id: string, name: string, tokens: number, costUsd: number | null) => ({ id, name, tokens, costUsd, agents: [{ name: 'main', tokens }], models: [{ name: 'claude-fable-5-2', tokens }], parts: id.startsWith('a') ? [{ agent: 'main', model: 'claude-fable-5-2', effort: 'high', tokens: 2000, costUsd: 2, turns: 3 }, { agent: 'Explore', model: 'claude-haiku-5-5', effort: '', tokens: 500, costUsd: null, turns: 1 }] : [], turns: 2 })
  const logs = [
    { month: '2026-11', days: [{ date: '2026-11-02', tokens: 4000, costUsd: 3, sessions: [session('aaaaaaaabbbb', 'alpha', 3000, 3), session('ccccccccdddd', '', 1000, null)] }] },
    { month: '2026-07', days: [{ date: '2026-07-04', tokens: 500, costUsd: 0.5, sessions: [] }] },
  ]
  const all = detailRows('usage', view({ logs }))
  const rows = all.slice(all.findIndex(r => r.kind === 'head'))
  const months = ['2026-11', '2026-07']
  const labels = (collapsed: string[]) => visibleRows(rows, collapsed).map(r => r.label).filter(Boolean)
  expect(rows[0]).toMatchObject({ kind: 'head', label: 'November 2026', value: '4.0k · $3.00', key: '2026-11', closed: true, bold: true })
  expect(labels([])).toEqual(['November 2026', 'July 2026'])
  expect(labels(months)).toEqual(['November 2026', '2026-11-02', 'July 2026', '2026-07-04'])
  expect(labels([...months, '2026-11/2026-11-02'])).toEqual(['November 2026', '2026-11-02', 'alpha', 'cccccccc', 'July 2026', '2026-07-04'])
  const open = visibleRows(rows, [...months, '2026-11/2026-11-02', '2026-11-02/aaaaaaaabbbb'])
  expect(open.map(r => r.label).slice(2, 6)).toEqual(['alpha', 'main · Fable 5.2 · high · 3', 'Explore · Haiku 5.5 · 1', 'cccccccc'])
  expect(open.find(r => r.label === 'alpha')).toMatchObject({ count: 2, after: '2 agents' })
  expect(open.find(r => r.label === 'cccccccc')).toMatchObject({ count: 2 })
  expect(open.find(r => r.label === 'cccccccc')?.after).toBeUndefined()
  const sessionRow = open.find(r => r.label === 'alpha')!
  expect(splitCount(rowParts(sessionRow, 60, 12, false, '▾').label, sessionRow)[1].trimEnd()).toBe(' · 2 · 2 agents')
  expect(open.slice(3, 5).map(r => [r.value, r.depth, r.kind])).toEqual([['2.0k · $2.00', 2, 'item'], ['500 · ░', 2, 'item']])
  const day = open.find(r => r.label === '2026-11-02')
  expect(day?.count).toBe(2)
  const drawn = rowParts(day ?? rows[0]!, 60, 12, false, '▾').label
  expect(splitCount(drawn, day ?? rows[0]!)).toEqual([drawn.slice(0, drawn.indexOf(' · 2')), drawn.slice(drawn.indexOf(' · 2'))])
  expect(splitCount(drawn, day ?? rows[0]!)[0].trimStart()).toBe('▾ 2026-11-02')
  expect(splitCount('plain', { kind: 'item', label: 'plain', value: '', share: null, indent: 0 })).toEqual(['plain', ''])
  const old = visibleRows(rows, [...months, '2026-11/2026-11-02', '2026-11-02/ccccccccdddd']).map(r => r.label)
  expect(old.slice(old.indexOf('cccccccc') + 1, old.indexOf('cccccccc') + 2)).toEqual(['main · Fable 5.2 · 2'])
  expect(open.filter(r => r.open !== undefined).map(r => r.open)).toEqual(['2026-11/aaaaaaaabbbb/2026-11-02/0', '2026-11/aaaaaaaabbbb/2026-11-02/1'])
  expect(rowParts(open.find(r => r.open !== undefined)!, 60, 12, false, '›').label.trimStart().startsWith('› main')).toBe(true)
  expect(labels([...months, '2026-11-02/aaaaaaaabbbb'])).not.toContain('main · Fable 5.2 · high · 3')
  expect(open.find(r => r.label === 'alpha')).toMatchObject({ kind: 'sub', depth: 1, share: 0.75 })
  expect(sectionBlocks(open).map(b => b.isSection)).toEqual([true, false, true])
})

test('the Prompts tab lists an opened session by turn, with a way back to this session', () => {
  const turn = (id: string, hour: number, tokens: number) => ({ id, session: 'aaaaaaaabbbb', at: new Date(2026, 10, 2, hour).getTime(), tokens, input: 1000, cacheRead: 0, output: 500, apiMs: 900, spanMs: 2000, costUsd: 1.5, linesAdded: 3, linesRemoved: 1, files: 1, calls: 2 })
  const sessionLog = { month: '2026-11', id: 'aaaaaaaabbbb', name: 'alpha', turns: [turn('t2', 11, 500), turn('t1', 9, 1500)] }
  const rows = detailRows('turns', view({ sessionLog }))
  expect(rows[0]).toMatchObject({ kind: 'item', open: '' })
  expect(rows[1]).toMatchObject({ kind: 'head', fixed: true, label: 'alpha · November 2026 · Turns 2 · Calls 4', titles: TURN_TITLES })
  expect(rows[1]?.cells).toEqual(['4s', '2.0k', '2.0k', '1.0k', rows[1]?.cells?.[4], '$3.00'])
  expect(rows[3]).toMatchObject({ kind: 'sub', label: '2026-11-02', key: turnDayKey('2026-11-02'), count: 2 })
  expect(rows.filter(r => r.depth === 2).map(r => [r.key, r.kind, r.cells?.[1], r.cells?.[5]])).toEqual([['t2', 'item', '500', '$1.50'], ['t1', 'item', '1.5k', '$1.50']])
  expect(detailRows('turns', view({ sessionLog: { ...sessionLog, turns: [] } })).at(-1)?.label).toBe('This file holds no prompts.')
  expect(detailRows('turns', view({ sessionLog: { ...sessionLog, id: view().session } }))[0]?.open).toBeUndefined()
  expect(detailRows('usage', view({ sessionLog })).some(r => r.open === '')).toBe(false)
  const usage = sectionBlocks(visibleRows([
    { kind: 'head', label: 'Total', value: '', share: null, indent: 0, fixed: true },
    { kind: 'head', label: 'Sessions', value: '', share: null, indent: 0 },
    { kind: 'item', label: 'one', value: '', share: null, indent: 0 },
    { kind: 'head', label: 'Agents', value: '', share: null, indent: 0 },
    { kind: 'item', label: 'main', value: '', share: null, indent: 0 },
  ], []))
  expect(usage.map(b => [b.isSection, b.items.map(i => i.row.label)])).toEqual([
    [false, ['Total']],
    [true, ['Sessions', 'one']],
    [false, ['']],
    [true, ['Agents', 'main']],
  ])
})
