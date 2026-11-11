import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, SessionContextBreakdown, RenderInput, UiMessageArgument, UiMessageResult } from 'claude-code'

import type { IndexDetailTab } from '../types'
import type { Config } from './lib/format'
import { isRecord } from './lib/git'
import { dayKey } from './lib/ledger'
import { openSessionLog, syncLedger } from './usage'
import {
  DETAIL_PANE,
  DETAIL_TABS,
  LOG_VALUE_WIDTH,
  cellWidths,
  sectionBlocks,
  turnDayKey,
  splitCount,
  columnTitles,
  detailRows,
  headLine,
  isCollapsed,
  isIdle,
  rowKey,
  centered,
  rowParts,
  splitMax,
  tableHeadLine,
  tableParts,
  tableTitles,
  titledHead,
  toContextDetail,
  valueWidthOf,
  visibleRows,
  type DetailRow,
} from './lib/detail'

// The validator reads an atom only in the file that declares it, so each file declares the atoms it uses.
const callLog = atom({ plugin: 'the-index', key: 'callLog' } as const, [])
const usageSummary = atom({ plugin: 'the-index', key: 'usageSummary' } as const, null)
const contextLog = atom({ plugin: 'the-index', key: 'contextLog' } as const, [])
const contextDetail = atom({ plugin: 'the-index', key: 'contextDetail' } as const, null)
const promptCounts = atom({ plugin: 'the-index', key: 'promptCounts' } as const, {})
const detailOpen = atom({ plugin: 'the-index', key: 'detailOpen' } as const, false)
const detailTab = atom({ plugin: 'the-index', key: 'detailTab' } as const, 'context')
const accountUsage = atom({ plugin: 'the-index', key: 'accountUsage' } as const, null)
const usageLogs = atom({ plugin: 'the-index', key: 'usageLogs' } as const, [])
const sessionLog = atom({ plugin: 'the-index', key: 'sessionLog' } as const, null)
const detailCollapsed = atom({ plugin: 'the-index', key: 'detailCollapsed' } as const, ['MCP Server Instructions', 'System Prompt', 'System Tools', 'Compactions', 'Memory Files', 'MCP Tools', 'Skills', 'Agents'])
const turnHistory = atom({ plugin: 'the-index', key: 'turnHistory' } as const, [])

const HEAD_ELEMENT = 'detail-head-'
const GOTO_ELEMENT = 'detail-goto-'
const TAB_ELEMENT = 'detail-tab-'
const LOG_ELEMENT = 'detail-log-'
const PROMPT_COUNT_SESSIONS = 20

let paneOffset = 0

const MCP_INSTRUCTIONS_TITLE = /^# MCP Server Instructions/m

// The instructions are a system prompt section on some builds and an injected message on others.
async function promptTexts($: EngineInterface): Promise<{ sections: { id: string; text: string }[]; instructions: string | null; note: string }> {
  let sections: { id: string; text: string }[] = []
  try {
    sections = (await $.prompt.compose()).sections.map(s => ({ id: s.id, text: s.text }))
    const section = sections.find(s => MCP_INSTRUCTIONS_TITLE.test(s.text))
    if (section) return { sections: sections.filter(s => s !== section), instructions: section.text.slice(section.text.search(MCP_INSTRUCTIONS_TITLE)), note: '' }
    const request = await $.session.messages({ as: 'api' })
    const texts = request.flatMap(m => (typeof m.content === 'string' ? [m.content] : m.content.flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))))
    const message = texts.findLast(t => MCP_INSTRUCTIONS_TITLE.test(t))
    if (message) return { sections, instructions: message.slice(message.search(MCP_INSTRUCTIONS_TITLE)).replace(/<\/system-reminder>\s*$/, ''), note: '' }
    return { sections, instructions: null, note: `Neither the system prompt (${sections.map(s => s.id).join(', ')}) nor the ${request.length} request messages hold the instructions.` }
  } catch (error) {
    return { sections, instructions: null, note: `The instructions could not be read: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// With `texts` off only the token breakdown is read; the prompt, instructions and tool texts stay as last read.
export async function refreshContextDetail($: EngineInterface, texts = true, known?: SessionContextBreakdown): Promise<void> {
  try {
    const [breakdown, fresh] = await Promise.all([known ?? $.session.usage({ breakdown: 'summary' }).then(u => u.context.breakdown), texts ? readContextTexts($) : null])
    if (!breakdown) return
    const detail = toContextDetail(breakdown)
    await update($, contextDetail, prev => ({ ...prev, ...detail, ...fresh }))
  } catch {
    // Without a bound session the breakdown rejects; the Context tab then shows its empty note.
  }
}

async function readContextTexts($: EngineInterface) {
  const [{ sections, instructions, note }, systemTools] = await Promise.all([
    promptTexts($),
    $.tool.list().then(list => list.filter(t => !t.mcp).map(t => ({ name: t.name, description: t.description })), () => []),
  ])
  return { systemPromptSections: sections, systemTools, mcpInstructionsText: instructions, mcpInstructionsNote: note }
}

export async function toggleDetail($: EngineInterface): Promise<void> {
  if (await read($, detailOpen)) {
    await $.ui.close({ id: DETAIL_PANE })
    await update($, detailOpen, () => false)
    return
  }
  await update($, detailOpen, () => true)
  void refreshContextDetail($)
  void syncLedger($).catch(() => undefined)
  const opened = await $.ui.open({ id: DETAIL_PANE, title: 'Details', columns: 120, rows: 24 })
  if (!opened.isPlaced) {
    await update($, detailOpen, () => false)
    await $.ui.close({ id: DETAIL_PANE })
    $.ui.toast(`Could not open the detail pane: ${opened.reason}`)
  }
}

export async function showDetailTab($: EngineInterface, tab: IndexDetailTab): Promise<void> {
  await update($, detailTab, () => tab)
  if (!(await read($, detailOpen))) await toggleDetail($)
}

export async function detailClosed($: EngineInterface): Promise<void> {
  await update($, detailOpen, () => false)
}

export async function countPrompt($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  await update($, promptCounts, ({ [id]: count = 0, ...others }) => ({ ...Object.fromEntries(Object.entries(others).slice(-(PROMPT_COUNT_SESSIONS - 1))), [id]: count + 1 }))
}

// A pane whose rows all fit shows its end, and the engine follows the end when the rows grow, which moves
// every row up. Scrolling back keeps the pressed row where it was.
async function holdWindow($: EngineInterface, offset: number, element: string): Promise<void> {
  try {
    await $.ui.scroll(offset === 0 ? { in: DETAIL_PANE, to: 'start' } : { in: DETAIL_PANE, to: { key: element }, block: 'nearest' })
  } catch {
    return
  }
}

export async function onPaneMessage($: EngineInterface, e: UiMessageArgument): Promise<UiMessageResult> {
  if (!isRecord(e.data) || e.data['press'] !== true) return {}
  if (e.element.startsWith(HEAD_ELEMENT)) {
    const key = e.element.slice(HEAD_ELEMENT.length)
    const offset = paneOffset
    await update($, detailCollapsed, prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
    await holdWindow($, offset, e.element)
    return {}
  }
  if (e.element.startsWith(LOG_ELEMENT)) {
    const target = e.element.slice(LOG_ELEMENT.length)
    await openSessionLog($, target).catch(() => undefined)
    if (!target) return {}
    const day = turnDayKey(target.split('/')[2] ?? '')
    const turns = (await read($, sessionLog))?.turns ?? []
    const isNewest = turns[0] !== undefined && turnDayKey(dayKey(turns[0].at)) === day
    // The list holds the closed rows a reader opened and the open rows a reader closed, and only the newest day starts open.
    await update($, detailCollapsed, prev => [...prev.filter(key => key !== day && !key.startsWith(`${day}/`)), ...(isNewest ? [] : [day])])
    await update($, detailTab, () => 'turns')
    await $.ui.scroll({ in: DETAIL_PANE, to: { key: `${HEAD_ELEMENT}${day}` }, block: 'start' }).catch(() => undefined)
    return {}
  }
  const tab = DETAIL_TABS.find(t => e.element === `${TAB_ELEMENT}${t.id}` || e.element === `${GOTO_ELEMENT}${t.id}`)
  if (tab) {
    if (tab.id === 'turns') await openSessionLog($, '').catch(() => undefined)
    await update($, detailTab, () => tab.id)
    if (tab.id === 'context') await refreshContextDetail($)
  }
  return {}
}

export async function renderDetail($: EngineInterface, e: RenderInput<'Pane'>, cfg: Config): Promise<RenderElement | null> {
  const table = $.ui.resolve(e)
  const Client = 'Client' in table ? table.Client : undefined
  if (!Client) return null
  paneOffset = e.props.scroll.offset
  const { Box, Text } = table
  const [tab, detail, calls, history, summary, session, collapsed, contexts, prompted, account, logs, opened, now] = await Promise.all([
    read($, detailTab),
    read($, contextDetail),
    read($, callLog),
    read($, turnHistory),
    read($, usageSummary),
    $.session.id(),
    read($, detailCollapsed),
    read($, contextLog),
    read($, promptCounts),
    read($, accountUsage),
    read($, usageLogs),
    read($, sessionLog),
    $.clock.now(),
  ])
  const allRows = detailRows(tab, { contextDetail: detail, callLog: calls, turnHistory: history, usage: summary, session, width: e.props.bodyColumns, contextLog: contexts, prompts: prompted[session] ?? 0, account, logs, sessionLog: opened, now })
  const rows = visibleRows(allRows, collapsed)
  const width = Math.max(20, e.props.bodyColumns)
  const valueWidth = valueWidthOf(allRows, tab === 'usage' ? LOG_VALUE_WIDTH : 0)
  const bars = false
  const widths = cellWidths(allRows)
  const drawRow = (row: DetailRow, i: number, inner: number) => {
      if (row.kind === 'note' && row.divider) {
        const above = rows[i - 1]
        const titles = above?.kind === 'head' && above.titles ? tableTitles(above, inner, widths) : row.columns ? columnTitles(row.columns, inner, valueWidth, bars) : null
        return (
          <Box key={`row${i}`} flexDirection="column">
            <Text color={cfg.colors.icons}>{` ${'─'.repeat(Math.max(1, inner))} `}</Text>
            {titles ? <Text color={cfg.colors.icons}>{` ${titles} `}</Text> : null}
          </Box>
        )
      }
      if (row.kind === 'note') {
        return (
          <Text key={`row${i}`} color={cfg.colors.icons} bold={row.style === 'heading'}>
            {row.center ? ` ${centered(row.label, inner)} ` : ` ${row.label} `}
          </Text>
        )
      }
      if (row.kind === 'head' && row.fixed && !row.titles) {
        const p = rowParts(row, inner, valueWidth, bars)
        return (
          <Text key={`row${i}`} color={isIdle(row) ? cfg.colors.icons : cfg.colors.model} bold>
            {row.center ? ` ${centered(row.label, inner)} ` : ` ${p.label}${p.bar}${p.tail} `}
          </Text>
        )
      }
      if (row.kind === 'head' && row.titles) {
        return (
          <Box key={`row${i}`} flexDirection="column">
            {i > 0 ? <Text> </Text> : null}
            <Text color={cfg.colors.model} bold>{` ${tableHeadLine(row, inner, widths)} `}</Text>
          </Box>
        )
      }
      if (row.kind === 'sub' && row.cells) {
        const key = rowKey(row)
        const p = tableParts(row, inner, widths, isCollapsed(row, collapsed) ? '▸' : '▾')
        const [tableName, tableRest] = splitCount(p.label, row)
        return (
          <Box key={`row${i}`} flexDirection="row">
            <Text> </Text>
            <Client
              key={`${HEAD_ELEMENT}${key}`}
              module="./clients/chip.tsx"
              props={{ text: '', color: cfg.colors.model, parts: [{ text: tableName, color: cfg.colors.model, ...(tableRest ? { bold: true } : {}) }, { text: `${tableRest}${p.tail}`, color: cfg.colors.model }] }}
            />
            <Text> </Text>
          </Box>
        )
      }
      if (row.cells) {
        const p = tableParts(row, inner, widths)
        return (
          <Text key={`row${i}`} color={cfg.colors.icons}>
            {` ${p.label}${p.tail} `}
          </Text>
        )
      }
      if (row.kind === 'head') {
        const key = rowKey(row)
        const titles = titledHead(rows, i, collapsed)
        const line = ` ${headLine(row, inner, isCollapsed(row, collapsed), valueWidth, bars)} `
        const tone = isIdle(row) ? cfg.colors.icons : cfg.colors.model
        const [headName, headRest] = splitCount(line, row)
        return (
          <Box key={`row${i}`} flexDirection="column">
            <Client
              key={`${HEAD_ELEMENT}${key}`}
              module="./clients/chip.tsx"
              props={
                row.max || headRest
                  ? { text: line, color: tone, parts: [...(headRest ? [{ text: headName, color: tone, bold: true }] : []), ...splitMax(headRest || line, row, tone, cfg.colors.icons)] }
                  : { text: line, color: tone, look: 'link', ...(row.bold ? { isBold: true } : {}) }
              }
            />
            {titles ? <Text color={cfg.colors.icons}>{` ${columnTitles(titles, inner, valueWidth, bars, rows[i + 1]?.kind === 'sub')} `}</Text> : null}
          </Box>
        )
      }
      if (row.kind === 'sub') {
        const key = rowKey(row)
        const p = rowParts(row, inner, valueWidth, bars, isCollapsed(row, collapsed) ? '▸' : '▾')
        const edge = p.edge
        const [name, rest] = splitCount(p.label, row)
        return (
          <Box key={`row${i}`} flexDirection="row">
            <Text> </Text>
            <Client
              key={`${HEAD_ELEMENT}${key}`}
              module="./clients/chip.tsx"
              props={{
                text: '',
                color: cfg.colors.session,
                parts: [
                  { text: name, color: isIdle(row) ? cfg.colors.icons : cfg.colors.model, ...(rest ? { bold: true } : {}) },
                ...(rest ? [{ text: rest, color: isIdle(row) ? cfg.colors.icons : cfg.colors.model }] : []),
                  { text: edge < 0 ? p.bar : p.bar.slice(0, edge), color: cfg.colors.calls },
                  ...(edge < 0 ? [] : [{ text: p.bar.charAt(edge), color: cfg.colors.calls, inverse: true }, { text: p.bar.slice(edge + 1), color: cfg.colors.calls }]),
                  ...splitMax(p.tail, row, isIdle(row) ? cfg.colors.icons : cfg.colors.model, cfg.colors.icons),
                ],
              }}
            />
            <Text> </Text>
          </Box>
        )
      }
      const parts = rowParts(row, inner, valueWidth, bars)
      if (row.open !== undefined) {
        const opener = rowParts(row, inner, valueWidth, bars, row.open ? '›' : '')
        return (
          <Client
            key={`${LOG_ELEMENT}${row.open}`}
            module="./clients/chip.tsx"
            props={{ text: ` ${opener.label}${opener.bar}${opener.tail} `, color: cfg.colors.model, look: 'link' }}
          />
        )
      }
      if (row.goto) {
        return (
          <Client
            key={`${GOTO_ELEMENT}${row.goto}`}
            module="./clients/chip.tsx"
            props={{ text: ` ${parts.label}${parts.bar}${parts.tail} `, color: cfg.colors.model, look: 'link' }}
          />
        )
      }
      return (
        <Box key={`row${i}`} flexDirection="row">
          <Text> </Text>
          <Text color={isIdle(row) ? cfg.colors.icons : cfg.colors.model}>
            {parts.label}
          </Text>
          <Text color={cfg.colors.calls}>{parts.edge < 0 ? parts.bar : parts.bar.slice(0, parts.edge)}</Text>
          {parts.edge < 0 ? null : (
            <Text color={cfg.colors.calls} inverse>
              {parts.bar.charAt(parts.edge)}
            </Text>
          )}
          {parts.edge < 0 ? null : <Text color={cfg.colors.calls}>{parts.bar.slice(parts.edge + 1)}</Text>}
          <Text color={tab !== 'turns' && !isIdle(row) ? cfg.colors.model : cfg.colors.icons}>
            {parts.tail}
          </Text>
          <Text> </Text>
        </Box>
      )
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {DETAIL_TABS.map(t => (
          <Client key={`${TAB_ELEMENT}${t.id}`} module="./clients/chip.tsx" props={{ text: ` ${t.label} `, color: cfg.colors.model, isActive: t.id === tab }} />
        ))}
      </Box>
      <Text> </Text>
      {sectionBlocks(rows).map((block, n) =>
        block.isSection ? (
          <Box key={`section${n}`} flexDirection="column" borderStyle="round" borderColor={cfg.colors.icons}>
            {block.items.map(({ row, index }) => drawRow(row, index, width - 4))}
          </Box>
        ) : (
          <Box key={`plain${n}`} flexDirection="column" paddingLeft={1}>
            {block.items.map(({ row, index }) => drawRow(row, index, width - 4))}
          </Box>
        ),
      )}
    </Box>
  )
}
