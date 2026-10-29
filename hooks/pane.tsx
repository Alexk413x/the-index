import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput, UiMessageArgument, UiMessageResult } from 'claude-code'

import type { Config } from './lib/format'
import { isRecord } from './lib/git'
import {
  DETAIL_PANE,
  DETAIL_TABS,
  cellWidths,
  columnTitles,
  detailRows,
  headLine,
  isCollapsed,
  isIdle,
  rowKey,
  rowParts,
  splitMax,
  tableHeadLine,
  tableParts,
  tableTitles,
  titledHead,
  toContextDetail,
  valueWidthOf,
  visibleRows,
} from './lib/detail'

// The validator reads an atom only in the file that declares it, so each file declares the atoms it uses.
const callLog = atom({ plugin: 'the-index', key: 'callLog' } as const, [])
const usageSummary = atom({ plugin: 'the-index', key: 'usageSummary' } as const, null)
const contextLog = atom({ plugin: 'the-index', key: 'contextLog' } as const, [])
const contextDetail = atom({ plugin: 'the-index', key: 'contextDetail' } as const, null)
const promptCounts = atom({ plugin: 'the-index', key: 'promptCounts' } as const, {})
const detailOpen = atom({ plugin: 'the-index', key: 'detailOpen' } as const, false)
const detailTab = atom({ plugin: 'the-index', key: 'detailTab' } as const, 'context')
const detailCollapsed = atom({ plugin: 'the-index', key: 'detailCollapsed' } as const, ['MCP Server Instructions', 'System Prompt', 'System Tools', 'Compactions', 'Memory Files', 'MCP Tools', 'Skills', 'Agents'])
const turnHistory = atom({ plugin: 'the-index', key: 'turnHistory' } as const, [])

const HEAD_ELEMENT = 'detail-head-'
const GOTO_ELEMENT = 'detail-goto-'
const TAB_ELEMENT = 'detail-tab-'
const PROMPT_COUNT_SESSIONS = 20

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
export async function refreshContextDetail($: EngineInterface, texts = true): Promise<void> {
  try {
    const [usageNow, fresh] = await Promise.all([$.session.usage({ breakdown: 'summary' }), texts ? readContextTexts($) : null])
    const breakdown = usageNow.context.breakdown
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
  const opened = await $.ui.open({ id: DETAIL_PANE, title: 'Details', columns: 120, rows: 24 })
  if (!opened.isPlaced) {
    await update($, detailOpen, () => false)
    await $.ui.close({ id: DETAIL_PANE })
    $.ui.toast(`Could not open the detail pane: ${opened.reason}`)
  }
}

export async function detailClosed($: EngineInterface): Promise<void> {
  await update($, detailOpen, () => false)
}

export async function countPrompt($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  await update($, promptCounts, ({ [id]: count = 0, ...others }) => ({ ...Object.fromEntries(Object.entries(others).slice(-(PROMPT_COUNT_SESSIONS - 1))), [id]: count + 1 }))
}

export async function onPaneMessage($: EngineInterface, e: UiMessageArgument): Promise<UiMessageResult> {
  if (!isRecord(e.data) || e.data['press'] !== true) return {}
  if (e.element.startsWith(HEAD_ELEMENT)) {
    const key = e.element.slice(HEAD_ELEMENT.length)
    await update($, detailCollapsed, prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
    return {}
  }
  const tab = DETAIL_TABS.find(t => e.element === `${TAB_ELEMENT}${t.id}` || e.element === `${GOTO_ELEMENT}${t.id}`)
  if (tab) {
    await update($, detailTab, () => tab.id)
    if (tab.id === 'context') await refreshContextDetail($)
  }
  return {}
}

export async function renderDetail($: EngineInterface, e: RenderInput<'Pane'>, cfg: Config): Promise<RenderElement | null> {
  const table = $.ui.resolve(e)
  const Client = 'Client' in table ? table.Client : undefined
  if (!Client) return null
  const { Box, Text } = table
  const [tab, detail, calls, history, summary, session, collapsed, contexts, prompted] = await Promise.all([
    read($, detailTab),
    read($, contextDetail),
    read($, callLog),
    read($, turnHistory),
    read($, usageSummary),
    $.session.id(),
    read($, detailCollapsed),
    read($, contextLog),
    read($, promptCounts),
  ])
  const allRows = detailRows(tab, { contextDetail: detail, callLog: calls, turnHistory: history, usage: summary, session, width: e.props.bodyColumns, contextLog: contexts, prompts: prompted[session] ?? 0 })
  const rows = visibleRows(allRows, collapsed)
  const width = Math.max(20, e.props.bodyColumns)
  const valueWidth = valueWidthOf(rows, collapsed)
  const bars = tab === 'usage'
  const widths = cellWidths(allRows)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {DETAIL_TABS.map(t => (
          <Client key={`${TAB_ELEMENT}${t.id}`} module="./clients/chip.tsx" props={{ text: ` ${t.label} `, color: cfg.colors.model, isActive: t.id === tab }} />
        ))}
      </Box>
      <Text> </Text>
      {rows.map((row, i) => {
        if (row.kind === 'note' && row.divider) {
          const above = rows[i - 1]
          const titles = above?.kind === 'head' && above.titles ? tableTitles(above, width - 2, widths) : row.columns ? columnTitles(row.columns, width - 2, valueWidth, bars) : null
          return (
            <Box key={`row${i}`} flexDirection="column">
              <Text color={cfg.colors.icons}>{` ${'─'.repeat(Math.max(1, width - 2))} `}</Text>
              {titles ? <Text color={cfg.colors.icons}>{` ${titles} `}</Text> : null}
            </Box>
          )
        }
        if (row.kind === 'note') {
          return (
            <Text key={`row${i}`} color={cfg.colors.icons} bold={row.style === 'heading'}>
              {` ${row.label} `}
            </Text>
          )
        }
        if (row.kind === 'head' && row.fixed && !row.titles) {
          const p = rowParts(row, width - 2, valueWidth, bars)
          return (
            <Text key={`row${i}`} color={isIdle(row) ? cfg.colors.icons : cfg.colors.model} bold>
              {` ${p.label}${p.bar}${p.tail} `}
            </Text>
          )
        }
        if (row.kind === 'head' && row.titles) {
          return (
            <Box key={`row${i}`} flexDirection="column">
              {i > 0 ? <Text> </Text> : null}
              <Text color={cfg.colors.model} bold>{` ${tableHeadLine(row, width - 2, widths)} `}</Text>
            </Box>
          )
        }
        if (row.kind === 'sub' && row.cells) {
          const key = rowKey(row)
          const p = tableParts(row, width - 2, widths, isCollapsed(row, collapsed) ? '▸' : '▾')
          return (
            <Box key={`row${i}`} flexDirection="row">
              <Text> </Text>
              <Client
                key={`${HEAD_ELEMENT}${key}`}
                module="./clients/chip.tsx"
                props={{ text: '', color: cfg.colors.model, parts: [{ text: p.label, color: cfg.colors.model }, { text: p.tail, color: cfg.colors.model }] }}
              />
              <Text> </Text>
            </Box>
          )
        }
        if (row.cells) {
          const p = tableParts(row, width - 2, widths)
          return (
            <Text key={`row${i}`} color={cfg.colors.icons}>
              {` ${p.label}${p.tail} `}
            </Text>
          )
        }
        if (row.kind === 'head') {
          const key = rowKey(row)
          const titles = titledHead(rows, i, collapsed)
          const line = ` ${headLine(row, width - 2, isCollapsed(row, collapsed), valueWidth, bars)} `
          const tone = isIdle(row) ? cfg.colors.icons : cfg.colors.model
          return (
            <Box key={`row${i}`} flexDirection="column">
              <Client
                key={`${HEAD_ELEMENT}${key}`}
                module="./clients/chip.tsx"
                props={row.max ? { text: '', color: tone, parts: splitMax(line, row, tone, cfg.colors.icons) } : { text: line, color: tone, look: 'link' }}
              />
              {titles ? <Text color={cfg.colors.icons}>{` ${columnTitles(titles, width - 2, valueWidth, bars, rows[i + 1]?.kind === 'sub')} `}</Text> : null}
            </Box>
          )
        }
        if (row.kind === 'sub') {
          const key = rowKey(row)
          const p = rowParts(row, width - 2, valueWidth, bars, isCollapsed(row, collapsed) ? '▸' : '▾')
          const edge = p.edge
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
                    { text: p.label, color: isIdle(row) ? cfg.colors.icons : cfg.colors.model },
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
        const parts = rowParts(row, width - 2, valueWidth, bars)
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
            <Text color={tab === 'context' && !isIdle(row) ? cfg.colors.model : cfg.colors.icons}>
              {parts.tail}
            </Text>
            <Text> </Text>
          </Box>
        )
      })}
    </Box>
  )
}
