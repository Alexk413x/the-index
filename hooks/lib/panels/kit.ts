import type { PanelView, RowItem } from '../panels'
import { MIDDLE_WIDTH, ROW_GAP, TITLE_WIDTH } from './constants'

const ACTION_WIDTH = 90

export function sectionWidth(items: readonly RowItem[]): number {
  return items.reduce((sum, item, i) => sum + item.text.length + (item.pad ?? 0) + (i > 0 && !item.tight ? ROW_GAP : 0), 0)
}

export function padTo(items: readonly RowItem[], width: number): RowItem[] {
  const last = items[items.length - 1]
  if (!last) return [...items]
  return [...items.slice(0, -1), { ...last, pad: (last.pad ?? 0) + Math.max(0, width - sectionWidth(items)) }]
}

export function rowKit(view: PanelView) {
  const { cfg } = view
  const note = (text: string): RowItem => ({ text, color: cfg.colors.icons })
  const title = (text: string): RowItem => ({ ...note(text), pad: Math.max(0, TITLE_WIDTH - text.length) })
  const middle = (items: RowItem[]) => padTo(items, MIDDLE_WIDTH)
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
  const tokensColor = cfg.colors.model
  const colored = (text: string, color: string): RowItem => ({ text, color })
  return { note, title, middle, blankTitle, chartRows, tokensColor, colored }
}

export type Kit = ReturnType<typeof rowKit>
