import type { IndexCallPoint, IndexContextDetail, IndexContextPoint, IndexDetailTab, IndexTurnRecord, IndexUsageSummary } from '../types'
import { categoryLabel, fmtClock, fmtCost, fmtDur, fmtMs, fmtNum, fmtPercent, fmtStamp } from './format'

export type DetailRow = {
  kind: 'head' | 'sub' | 'item' | 'note'
  label: string
  value: string
  share: number | null
  indent: 0 | 1
  dim?: boolean
  divider?: boolean
  columns?: DetailColumns
  cells?: readonly string[]
  titles?: readonly string[]
  fixed?: boolean
  key?: string
  closed?: boolean
  max?: string
  style?: 'heading' | 'code' | 'text'
  goto?: IndexDetailTab
}

export type DetailColumns = readonly [name: string, share: string, value: string]

export type DetailView = {
  contextDetail: IndexContextDetail | null
  callLog: readonly IndexCallPoint[]
  turnHistory: readonly IndexTurnRecord[]
  usage: IndexUsageSummary | null
  session: string
  width?: number
  contextLog?: readonly IndexContextPoint[]
  prompts?: number
}

export const DETAIL_TABS: readonly { id: IndexDetailTab; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'turns', label: 'Prompts' },
  { id: 'usage', label: 'Usage' },
]

const DETAIL_TURN_LIMIT = 100

const MCP_PREFIX = /^mcp__(.+?)__/
const MCP_INSTRUCTIONS = /mcp.*instructions/i
const SYSTEM_PROMPT = /^system prompt$/i
const SYSTEM_TOOLS = /^system tools$/i
const INSTRUCTIONS_TITLE_CHARS = '# MCP Server Instructions\n'.length
const HEADING_CHARS = '## \n'.length

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0)
}

function share(value: number, whole: number): number | null {
  return whole > 0 ? Math.min(1, Math.max(0, value / whole)) : null
}

function money(usd: number | null): string {
  return usd === null ? '░' : `$${fmtCost(usd)}`
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function folderOf(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).slice(0, -1).slice(-2).join('/')
}

function head(label: string, value: string, columns?: DetailColumns, fraction: number | null = null): DetailRow {
  return { kind: 'head', label, value, share: fraction, indent: 0, ...(columns ? { columns } : {}) }
}

function item(label: string, value: string, fraction: number | null, indent: 0 | 1 = 0, dim = false): DetailRow {
  return { kind: 'item', label, value, share: fraction, indent, ...(dim ? { dim } : {}) }
}

function sub(label: string, value: string, fraction: number | null): DetailRow {
  return { kind: 'sub', label, value, share: fraction, indent: 0 }
}

function note(label: string): DetailRow {
  return { kind: 'note', label, value: '', share: null, indent: 0 }
}

// Each compaction with the context it left; the head reads 0% until one happens.
function contextAt(p: IndexContextPoint): string {
  return `${Math.round(p.percent)}%${p.tokens === null ? '' : ` · ${fmtNum(p.tokens)}`}`
}

function compactionRows(log: readonly IndexContextPoint[]): DetailRow[] {
  const found = log.flatMap((p, i) => (p.compaction ? [{ p, from: log[i - 1] }] : []))
  const lines =
    found.length === 0
      ? ['No compactions in this session.']
      : found.map(({ p, from }) => `${fmtClock(p.at, true)} ${p.compaction} ${from ? `${contextAt(from)} ` : ''}-> ${contextAt(p)}`)
  return [head(`Compactions (${found.length})`, '', ['Compaction', 'Context', 'Tokens'], found.length === 0 ? 0 : null), ...lines.map(l => ({ ...note(`   ${l}`), style: 'text' as const }))]
}

function callsLabel(count: number): string {
  return `${count} ${count === 1 ? 'call' : 'calls'}`
}

function byTokens<T extends { tokens: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.tokens - a.tokens)
}

function contextRows(detail: IndexContextDetail | null, width: number, contextLog: readonly IndexContextPoint[], turns: readonly IndexTurnRecord[], prompts: number): DetailRow[] {
  if (!detail) return [note('The context breakdown has not been read yet.')]
  const { window } = detail
  const rows: DetailRow[] = [
    ...compactionRows(contextLog),
    { ...head(`Context window · ${fmtNum(window)}`, fmtNum(detail.total), undefined, share(detail.total, window)), fixed: true },
    { ...note(''), divider: true },
  ]

  const sectioned = new Set([
    ...(detail.memoryFiles.length > 0 ? ['memory files'] : []),
    ...(detail.mcpTools.length > 0 ? ['mcp tools'] : []),
    ...(detail.skills.length > 0 ? ['skills'] : []),
    ...(detail.agents.length > 0 ? ['custom agents', 'agents'] : []),
  ])
  const loose = byTokens(detail.categories.filter(c => !c.deferred && !sectioned.has(c.name.toLowerCase())))
  const instructions = loose.find(c => MCP_INSTRUCTIONS.test(c.name))
  const prompt = detail.systemPromptSections?.length ? loose.find(c => SYSTEM_PROMPT.test(c.name)) : undefined
  const tools = detail.systemTools?.length ? loose.find(c => SYSTEM_TOOLS.test(c.name)) : undefined
  const blocks: { tokens: number; rows: DetailRow[] }[] = []
  for (const c of loose) {
    if (c === instructions || c === prompt || c === tools) continue
    const label = c.name === 'Messages' ? `${categoryLabel(c.name)} (${prompts}) · ${turns.length} ${turns.length === 1 ? 'turn' : 'turns'} · ${callsLabel(sum(turns, t => t.calls ?? 0))} · ${fmtDur(sum(turns, t => t.spanMs) / 1000)}` : categoryLabel(c.name)
    rows.push({ ...item(label, fmtNum(c.tokens), share(c.tokens, window)), ...(c.name === 'Messages' ? { goto: 'turns' as const } : {}) })
  }
  if (tools) {
    const biggest = [...(detail.systemTools ?? [])].sort((a, b) => b.description.length - a.description.length)
    blocks.push({ tokens: tools.tokens, rows: textRows(categoryLabel(tools.name), tools.tokens, window, width, [], biggest.map(t => ({ key: `system-tools:${t.name}`, name: t.name, text: t.description }))) })
  }
  if (prompt) blocks.push({ tokens: prompt.tokens, rows: textRows(categoryLabel(prompt.name), prompt.tokens, window, width, [], (detail.systemPromptSections ?? []).map(s => ({ key: s.id, name: s.id, text: s.text }))) })
  if (instructions) {
    const parsed = detail.mcpInstructionsText ? mcpSections(detail.mcpInstructionsText, [...new Set(detail.mcpTools.map(t => t.server))]) : null
    const intro = parsed?.intro.join('\n') ?? ''
    const sections = [
      ...(intro.trim() === '' ? [] : [{ key: 'mcp-instructions-intro', name: 'Intro', text: intro, extra: INSTRUCTIONS_TITLE_CHARS }]),
      ...(parsed?.sections ?? []).map(s => ({ key: `mcp-instructions:${s.name}`, name: s.name, text: s.lines.join('\n'), extra: s.name.length + HEADING_CHARS })),
    ]
    blocks.push({ tokens: instructions.tokens, rows: textRows(categoryLabel(instructions.name), instructions.tokens, window, width, parsed ? [] : [detail.mcpInstructionsNote || 'The instructions text has not been read.'], sections) })
  }

  if (detail.memoryFiles.length > 0) {
    const files = byTokens(detail.memoryFiles).map(f => ({ name: baseName(f.path), type: f.type, folder: folderOf(f.path), tokens: f.tokens }))
    const nameWidth = Math.max('File'.length, ...files.map(f => f.name.length))
    const typeWidth = Math.max('Type'.length, ...files.map(f => f.type.length))
    const cells = (name: string, type: string, folder: string) => `${name.padEnd(nameWidth)}  ${type.padEnd(typeWidth)}  ${folder}`.trimEnd()
    const block = [head(`Memory Files (${files.length})`, fmtNum(sum(files, f => f.tokens)), [cells('File', 'Type', 'Folder'), 'Context', 'Tokens'], share(sum(files, f => f.tokens), window))]
    for (const f of files) block.push(item(cells(f.name, f.type, f.folder), fmtNum(f.tokens), share(f.tokens, window)))
    blocks.push({ tokens: sum(files, f => f.tokens), rows: block })
  }

  if (detail.mcpTools.length > 0) {
    const servers = new Map<string, IndexContextDetail['mcpTools'][number][]>()
    for (const tool of detail.mcpTools) servers.set(tool.server, [...(servers.get(tool.server) ?? []), tool])
    const loaded = (tools: readonly { tokens: number; loaded: boolean }[]) => sum(tools.filter(t => t.loaded), t => t.tokens)
    const all = detail.mcpTools
    // The loaded tokens are the value; deferred tools add to the grey maximum that follows them.
    const possible = (tools: readonly { tokens: number; loaded: boolean }[]) => {
      const max = sum(tools, t => t.tokens)
      return max > loaded(tools) ? ` / ${fmtNum(max)}` : ''
    }
    const block: DetailRow[] = [{ ...head(`MCP Tools (${all.length})`, `${fmtNum(loaded(all))}${possible(all)}`, ['Server / Tool', 'Context', 'Tokens'], share(loaded(all), window)), ...(possible(all) ? { max: possible(all) } : {}) }]
    const ordered = [...servers.entries()].sort((a, b) => loaded(b[1]) - loaded(a[1]))
    for (const [server, tools] of ordered) {
      block.push({
        ...sub(`${server} (${tools.length})`, `${fmtNum(loaded(tools))}${possible(tools)}`, share(loaded(tools), window)),
        key: `mcp-server:${server}`,
        closed: true,
        ...(possible(tools) ? { max: possible(tools) } : {}),
      })
      for (const t of byTokens(tools)) {
        block.push(item(t.name.replace(MCP_PREFIX, ''), fmtNum(t.tokens), share(t.loaded ? t.tokens : 0, window), 1, !t.loaded))
      }
    }
    blocks.push({ tokens: loaded(all), rows: block })
  }

  if (detail.skills.length > 0) {
    const block = [head(`Skills (${detail.skills.length})`, fmtNum(sum(detail.skills, s => s.tokens)), ['Skill', 'Context', 'Tokens'], share(sum(detail.skills, s => s.tokens), window))]
    for (const s of byTokens(detail.skills)) block.push(item(s.name, fmtNum(s.tokens), share(s.tokens, window)))
    blocks.push({ tokens: sum(detail.skills, s => s.tokens), rows: block })
  }

  if (detail.agents.length > 0) {
    const block = [head(`Agents (${detail.agents.length})`, fmtNum(sum(detail.agents, a => a.tokens)), ['Agent', 'Context', 'Tokens'], share(sum(detail.agents, a => a.tokens), window))]
    for (const a of byTokens(detail.agents)) block.push(item(a.type, fmtNum(a.tokens), share(a.tokens, window)))
    blocks.push({ tokens: sum(detail.agents, a => a.tokens), rows: block })
  }
  rows.push(...byTokens(blocks).flatMap(b => b.rows))
  return rows
}

function lineChanges(added: number | undefined, removed: number | undefined): string {
  return added === undefined || removed === undefined || added + removed === 0 ? '' : `+${added} -${removed}`
}

function openTurn(id: string, session: string, group: readonly IndexCallPoint[]): IndexTurnRecord {
  const ordered = [...group].sort((a, b) => a.at - b.at)
  const first = ordered[0]!
  const last = ordered[ordered.length - 1]!
  const costs = ordered.flatMap(c => (c.costUsd === null ? [] : [c.costUsd]))
  return {
    id,
    session,
    at: last.at,
    tokens: sum(ordered, c => c.tokens),
    input: sum(ordered, c => c.tokens - c.output),
    cacheRead: sum(ordered, c => c.cacheRead),
    output: sum(ordered, c => c.output),
    apiMs: sum(ordered, c => c.apiMs),
    spanMs: last.at - (first.at - first.apiMs),
    costUsd: costs.length === ordered.length ? sum(costs, c => c) : null,
    linesAdded: sum(ordered, c => c.linesAdded ?? 0),
    linesRemoved: sum(ordered, c => c.linesRemoved ?? 0),
    files: 0,
    calls: ordered.length,
  }
}

export function callKind(index: number, tools: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const name of tools) {
    const shown = name.replace(MCP_PREFIX, '$1:')
    counts.set(shown, (counts.get(shown) ?? 0) + 1)
  }
  const what = counts.size === 0 ? 'Answer' : [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')
  return index === 0 ? `Prompt → ${what}` : what
}

export const TURN_TITLES = ['Turn (Calls)', 'Time', 'Tokens', '↑In', '↓Out', 'Lines', 'Cost'] as const

function turnsOf(history: readonly IndexTurnRecord[], calls: readonly IndexCallPoint[], session: string): { mine: IndexTurnRecord[]; byTurn: Map<string, IndexCallPoint[]> } {
  const byTurn = new Map<string, IndexCallPoint[]>()
  for (const c of calls) {
    const group = byTurn.get(c.turnId)
    if (group) group.push(c)
    else byTurn.set(c.turnId, [c])
  }
  const recorded = history.filter(t => t.session === session)
  const known = new Set(recorded.map(t => t.id))
  const open = [...byTurn].filter(([id]) => !known.has(id)).map(([id, group]) => openTurn(id, session, group))
  return { mine: [...recorded, ...open].sort((a, b) => b.at - a.at), byTurn }
}

function turnRows(history: readonly IndexTurnRecord[], calls: readonly IndexCallPoint[], session: string, prompts: number): DetailRow[] {
  const { mine, byTurn } = turnsOf(history, calls, session)
  if (mine.length === 0) return [note('No finished turns yet in this session.')]
  const shown = mine.slice(0, DETAIL_TURN_LIMIT)
  const costs = mine.flatMap(t => (t.costUsd === null ? [] : [t.costUsd]))
  const rows: DetailRow[] = [
    {
      kind: 'head',
      label: `Prompts ${prompts} · Turns ${mine.length} · Calls ${sum(mine, t => t.calls ?? 0)}`,
      value: '',
      share: null,
      indent: 0,
      fixed: true,
      titles: TURN_TITLES,
      cells: [
        fmtDur(sum(mine, t => t.spanMs) / 1000),
        fmtNum(sum(mine, t => t.tokens)),
        fmtNum(sum(mine, t => t.input)),
        fmtNum(sum(mine, t => t.output)),
        lineChanges(sum(mine, t => t.linesAdded), sum(mine, t => t.linesRemoved)),
        costs.length > 0 ? money(sum(costs, c => c)) : '░',
      ],
    },
    { ...note(''), divider: true },
  ]
  for (const t of shown) {
    rows.push({
      kind: 'sub',
      label: `${fmtStamp(t.at, true)} (${t.calls ?? 0})`,
      value: '',
      share: null,
      indent: 0,
      key: t.id,
      closed: true,
      cells: [fmtDur(t.spanMs / 1000), fmtNum(t.tokens), fmtNum(t.input), fmtNum(t.output), lineChanges(t.linesAdded, t.linesRemoved), money(t.costUsd)],
    })
    for (const c of [...(byTurn.get(t.id) ?? [])].sort((x, y) => x.at - y.at)) {
      rows.push({
        kind: 'item',
        label: c.kind ? `${fmtClock(c.at, true)} ${c.kind}` : fmtClock(c.at, true),
        value: '',
        share: null,
        indent: 1,
        cells: [fmtMs(c.apiMs), fmtNum(c.tokens), fmtNum(c.tokens - c.output), fmtNum(c.output), lineChanges(c.linesAdded, c.linesRemoved), money(c.costUsd)],
      })
    }
  }
  if (mine.length > shown.length) rows.push(note(`Showing the latest ${shown.length} of ${mine.length} turns.`))
  return rows
}

function usageRows(usage: IndexUsageSummary | null): DetailRow[] {
  if (!usage) return [note('No usage has been recorded yet.')]
  const days = usage.days.filter(d => d.tokens > 0).reverse()
  const costs = days.flatMap(d => (d.costUsd === null ? [] : [d.costUsd]))
  const peak = Math.max(0, ...days.map(d => d.tokens))
  const rows: DetailRow[] = [
    { ...head(`Last ${usage.days.length} days`, `${fmtNum(sum(days, d => d.tokens))} · ${costs.length > 0 ? money(sum(costs, c => c)) : '░'}`), fixed: true },
    ...(usage.since ? [{ ...head(`All time since ${usage.since}`, `${fmtNum(usage.allTokens)} · ${money(usage.allCostUsd)}`), fixed: true }] : []),
    { ...note(''), divider: true, columns: ['Day', 'Peak', 'Tokens · cost'] },
  ]
  for (const d of days) rows.push(item(d.date, `${fmtNum(d.tokens)} · ${money(d.costUsd)}`, share(d.tokens, peak)))
  if (days.length === 0) rows.push(note('No tokens in this range.'))
  return rows
}

export function detailRows(tab: IndexDetailTab, view: DetailView): DetailRow[] {
  if (tab === 'turns') return turnRows(view.turnHistory, view.callLog, view.session, view.prompts ?? 0)
  if (tab === 'usage') return usageRows(view.usage)
  return contextRows(view.contextDetail, view.width ?? 72, view.contextLog ?? [], turnsOf(view.turnHistory, view.callLog, view.session).mine, view.prompts ?? 0)
}

export const DETAIL_BAR = 8

// A deferred item, or one or a head that uses no tokens, reads grey; everything else reads orange.
export function isIdle(row: DetailRow): boolean {
  return row.dim === true || row.share === 0
}

export function headKey(label: string): string {
  return label.replace(/ \(\d+\)$/, '')
}

export function rowKey(row: DetailRow): string {
  return row.key ?? headKey(row.label)
}

// The collapsed list holds the keys of rows folded by the reader; for a row that starts closed it holds the ones opened.
export function isCollapsed(row: DetailRow, collapsed: readonly string[]): boolean {
  const listed = collapsed.includes(rowKey(row))
  return row.closed ? !listed : listed
}

// Splits a line or tail so the row's maximum, which ends its value, gets its own colour.
export function splitMax(text: string, row: DetailRow, color: string, maxColor: string): { text: string; color: string }[] {
  const at = row.max ? text.lastIndexOf(row.max) : -1
  if (!row.max || at < 0) return [{ text, color }]
  return [
    { text: text.slice(0, at), color },
    { text: row.max, color: maxColor },
    { text: text.slice(at + row.max.length), color },
  ]
}

// A head with column titles puts its total and share in the same columns as the rows under it.
export function headLine(row: DetailRow, width: number, isCollapsed: boolean, valueWidth = 0, bars = true): string {
  const arrow = isCollapsed ? '▸' : '▾'
  if (!row.columns) {
    const lead = ` ${arrow} ${row.value ? `${row.label} · ${row.value}` : row.label} `
    return lead.padEnd(width)
  }
  const geometry = rowParts({ kind: 'item', label: '', value: row.value, share: row.share, indent: 0 }, width, valueWidth, bars)
  const leftWidth = geometry.label.length + geometry.bar.length
  const lead = ` ${arrow} ${row.label} `
  const left = lead.length > leftWidth ? `${lead.slice(0, leftWidth - 1)}…` : lead.padEnd(leftWidth)
  const share = row.share === null ? ' '.repeat(DETAIL_PERCENT) : geometry.percent
  return `${left}${bars ? ` ${share} ${geometry.value}` : ` ${geometry.value} ${share}`}`
}

// The column titles under a head: it has them, is expanded, and an item follows it.
export function titledHead(rows: readonly DetailRow[], index: number, collapsed: readonly string[]): DetailColumns | null {
  const row = rows[index]
  if (row?.kind !== 'head' || !row.columns || isCollapsed(row, collapsed)) return null
  const next = rows[index + 1]?.kind
  return next === 'item' || next === 'sub' ? row.columns : null
}

export function valueWidthOf(rows: readonly DetailRow[], collapsed: readonly string[]): number {
  return Math.max(
    0,
    ...rows.flatMap(row => (row.kind === 'item' || row.kind === 'sub' || (row.kind === 'head' && (row.columns || row.fixed)) ? [row.value.length] : [])),
    ...rows.flatMap((_, i) => [titledHead(rows, i, collapsed)?.[2].length ?? 0]),
  )
}

export function columnTitles(columns: DetailColumns, width: number, valueWidth: number, bars = true, nested = false): string {
  const parts = rowParts({ kind: nested ? 'sub' : 'item', label: columns[0], value: columns[2], share: null, indent: 0 }, width, valueWidth, bars)
  if (!bars) {
    return `${parts.label} ${parts.value} ${columns[1].slice(0, DETAIL_PERCENT).padStart(DETAIL_PERCENT)}`
  }
  return `${parts.label}${columns[1].slice(0, DETAIL_BAR + DETAIL_PERCENT + 1).padStart(DETAIL_BAR + DETAIL_PERCENT + 1)} ${parts.value}`
}

// A collapsed head hides every row up to the next head; a collapsed sub hides the indented rows under it.
// An expanded sub or head ends with an empty row, so the next one starts apart from it and collapsed heads sit together.
export function visibleRows(rows: readonly DetailRow[], collapsed: readonly string[]): DetailRow[] {
  const out: DetailRow[] = []
  let headHidden = false
  let subHidden = false
  let sectionOpen = false
  for (const row of rows) {
    if (row.kind === 'note' && row.divider) {
      if (sectionOpen && !(out.at(-1)?.kind === 'note' && out.at(-1)?.label === '')) out.push(note(''))
      headHidden = false
      subHidden = false
      sectionOpen = false
      out.push(row)
    } else if (row.kind === 'head') {
      if (sectionOpen && !(out.at(-1)?.kind === 'note' && out.at(-1)?.label === '')) out.push(note(''))
      headHidden = !row.fixed && isCollapsed(row, collapsed)
      sectionOpen = !row.fixed && !headHidden
      subHidden = false
      out.push(row)
    } else if (row.kind === 'sub') {
      const previous = out.at(-1)
      if (previous?.indent === 1) out.push(note(''))
      subHidden = isCollapsed(row, collapsed)
      if (!headHidden) out.push(row)
    } else if (!headHidden && !(subHidden && row.indent === 1)) {
      if (row.kind === 'item' && row.indent === 0 && out.at(-1)?.indent === 1) out.push(note(''))
      out.push(row)
    }
  }
  return out
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const

// The bar grows from the right edge to the left. Its partial cell is a left block drawn inverse, so the
// empty eighths sit on the left and the filled ones on the right; `edge` is that cell's index, or -1.
function drawBar(fraction: number | null): { bar: string; edge: number } {
  if (fraction === null) return { bar: ' '.repeat(DETAIL_BAR), edge: -1 }
  const eighths = fraction > 0 ? Math.max(1, Math.round(fraction * DETAIL_BAR * 8)) : 0
  const full = Math.floor(eighths / 8)
  const rest = eighths % 8
  const edge = rest > 0 ? DETAIL_BAR - full - 1 : -1
  return { bar: ' '.repeat(DETAIL_BAR - full - (rest > 0 ? 1 : 0)) + (rest > 0 ? EIGHTHS[rest] : '') + '█'.repeat(full), edge }
}

export const DETAIL_PERCENT = 7

// Every row starts with a 3-character gutter that holds the arrow of a row that expands, and blanks for one that does not.
function gutter(marker: string): string {
  return ` ${marker || ' '} `
}

export function percentText(fraction: number | null): string {
  if (fraction === null) return '—'.padStart(DETAIL_PERCENT)
  return fmtPercent(fraction * 100).padStart(DETAIL_PERCENT)
}

// Every row of a view passes the same `valueWidth`, so bars, percentages and values start in the same columns.
// With `bars` off the row reads label, value, percentage; `tail` is everything after the bar.
export function rowParts(
  row: DetailRow,
  width: number,
  valueWidth = row.value.length,
  bars = true,
  marker = '',
): { label: string; bar: string; edge: number; percent: string; value: string; tail: string } {
  const room = Math.max(4, width - valueWidth - DETAIL_PERCENT - 3 - (bars ? DETAIL_BAR : 0))
  const text = `${row.kind === 'sub' ? ' ' : ''}${gutter(marker)}${row.indent === 1 ? '  ' : ''}${row.label}`
  const label = text.length > room ? `${text.slice(0, room - 1)}…` : text.padEnd(room)
  const percent = percentText(row.share)
  const value = row.value.padStart(valueWidth)
  const drawn = bars ? drawBar(row.share) : { bar: '', edge: -1 }
  return { label, ...drawn, percent, value, tail: bars ? ` ${percent} ${value}` : ` ${value} ${percent}` }
}

// Wraps at spaces to `room` columns; each continuation line starts `hang` columns in.
function wrap(text: string, room: number, hang: number): string[] {
  const out: string[] = []
  let rest = text
  let lead = ''
  while (lead.length + rest.length > room) {
    const space = rest.lastIndexOf(' ', room - lead.length)
    const at = space > (room - lead.length) / 2 ? space : room - lead.length
    out.push(lead + rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
    lead = ' '.repeat(hang)
  }
  if (rest !== '') out.push(lead + rest)
  return out
}

// Markdown as pane rows, by line: headings, fenced code and wrapped bullets; inline marks stay as written.
export function markdownRows(text: string, width: number, indent: 0 | 1): DetailRow[] {
  const prefix = indent === 1 ? '     ' : '   '
  const room = Math.max(20, width - prefix.length - 4)
  const rows: DetailRow[] = []
  const add = (lines: readonly string[], style: 'heading' | 'code' | 'text') => {
    for (const line of lines) rows.push({ ...note(prefix + line), indent, style })
  }
  let fenced = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (line.trim() === '') continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const bullet = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (fenced) add(wrap(line, room, 0), 'code')
    else if (heading) add(wrap(heading[1]!, room, 0), 'heading')
    else if (bullet) add(wrap(`${bullet[1]}${/^\d/.test(bullet[2]!) ? bullet[2] : '•'} ${bullet[3]}`, room, bullet[1]!.length + 2), 'text')
    else add(wrap(line, room, line.length - line.trimStart().length), 'text')
  }
  return rows
}

// The instructions text splits at each `## <server>` heading. Only a heading naming a connected server splits it,
// because a server's own text may hold `##` headings; when no heading names one, every `##` splits.
export function mcpSections(text: string, servers: readonly string[]): { intro: string[]; sections: { name: string; lines: string[] }[] } {
  const lines = text.split('\n').filter(l => !/^# MCP Server Instructions/.test(l))
  const heading = (line: string) => /^## (.+)$/.exec(line)?.[1]?.trim()
  const known = new Set(servers)
  const anyKnown = lines.some(l => known.has(heading(l) ?? ''))
  const intro: string[] = []
  const sections: { name: string; lines: string[] }[] = []
  for (const line of lines) {
    const name = heading(line)
    if (name && (!anyKnown || known.has(name))) sections.push({ name, lines: [] })
    else (sections.at(-1)?.lines ?? intro).push(line)
  }
  return { intro, sections }
}

// A head holding a text, split into collapsible sections that start closed. Each section's tokens are the head's measured
// tokens shared out by text length.
function textRows(
  label: string,
  tokens: number,
  window: number,
  width: number,
  intro: readonly string[],
  sections: readonly { key: string; name: string; text: string; extra?: number }[],
): DetailRow[] {
  const weight = (s: { text: string; extra?: number }) => s.text.length + (s.extra ?? 0)
  const total = sum(sections, weight) + sum(intro, l => l.length)
  const rows: DetailRow[] = [head(sections.length > 0 ? `${label} (${sections.length})` : label, fmtNum(tokens), ['Section', 'Context', 'Tokens'], share(tokens, window)), ...markdownRows(intro.join('\n'), width, 0)]
  for (const s of sections) {
    const estimate = total > 0 ? Math.round((tokens * weight(s)) / total) : 0
    rows.push({ ...sub(s.name, fmtNum(estimate), share(estimate, window)), key: s.key, closed: true }, ...markdownRows(s.text, width, 1))
  }
  return rows
}

export function toContextDetail(breakdown: {
  totalTokens: number
  maxTokens: number
  categories: readonly { name: string; tokens: number; isDeferred: boolean; kind: string }[]
  memoryFiles: readonly { path: string; type: string; tokens: number }[]
  mcpTools: readonly { name: string; serverName: string; tokens: number; isLoaded: boolean }[]
  skills?: { skillFrontmatter: readonly { name: string; source: string; tokens: number }[] }
  agents: readonly { agentType: string; source: string; tokens: number }[]
}): IndexContextDetail {
  return {
    window: breakdown.maxTokens,
    total: breakdown.totalTokens,
    categories: breakdown.categories
      .filter(c => c.kind === 'used' || c.kind === 'deferred')
      .map(c => ({ name: c.name, tokens: c.tokens, deferred: c.kind === 'deferred' })),
    memoryFiles: breakdown.memoryFiles.map(f => ({ path: f.path, type: f.type, tokens: f.tokens })),
    mcpTools: breakdown.mcpTools.map(t => ({ name: t.name, server: t.serverName, tokens: t.tokens, loaded: t.isLoaded })),
    skills: (breakdown.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, source: s.source, tokens: s.tokens })),
    agents: breakdown.agents.map(a => ({ type: a.agentType, source: a.source, tokens: a.tokens })),
  }
}

// The Turns table: a label column, then one column per cell, each as wide as its widest cell or title.
export function cellWidths(rows: readonly DetailRow[]): number[] {
  const titles = rows.find(r => r.titles)?.titles?.slice(1) ?? []
  return titles.map((title, c) => Math.max(title.length, ...rows.map(r => r.cells?.[c]?.length ?? 0)))
}

export function tableParts(row: DetailRow, width: number, widths: readonly number[], marker = ''): { label: string; tail: string } {
  const tail = widths.map((w, c) => ` ${(row.cells?.[c] ?? '').padStart(w)}`).join('')
  const room = Math.max(4, width - tail.length - 1)
  const text = `${gutter(marker)}${row.label}`
  return { label: text.length > room ? `${text.slice(0, room - 1)}…` : text.padEnd(room), tail }
}

export function tableTitles(row: DetailRow, width: number, widths: readonly number[]): string {
  const titles = row.titles ?? []
  const parts = tableParts({ kind: 'item', label: titles[0] ?? '', value: '', share: null, indent: 0, cells: titles.slice(1) }, width, widths)
  return parts.label + parts.tail
}

export function tableHeadLine(row: DetailRow, width: number, widths: readonly number[]): string {
  const parts = tableParts({ ...row, label: '' }, width, widths)
  const room = parts.label.length
  const label = ` ${row.label}`
  return (label.length > room ? `${label.slice(0, room - 1)}…` : label.padEnd(room)) + parts.tail
}

// The user's own Enter at the terminal or through the Remote Control bridge; a notification, schedule, peer or plugin submission is not a prompt.
export function isUserPrompt(kind: string, isMeta?: boolean): boolean {
  return !isMeta && (kind === 'composer' || kind === 'bridge')
}
