import type { RowItem } from './panels'

export type Series = { values: readonly number[]; color: string; max?: number }

const BRAILLE_BASE = 0x2800
// Braille dot bits by [column][row from the top] of a 2×4 cell.
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const
const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

function dotColumn(index: number, count: number, width: number): number {
  const cols = width * 2
  return count <= 1 ? Math.floor((cols - 1) / 2) : Math.round((index * (cols - 1)) / (count - 1))
}

function plot(values: readonly number[], width: number, height: number, ceiling?: number): Uint8Array {
  const cols = width * 2
  const rows = height * 4
  const grid = new Uint8Array(cols * rows)
  const max = ceiling ?? Math.max(0, ...values)
  if (values.length === 0 || max <= 0) return grid
  const point = (i: number): [number, number] => [
    dotColumn(i, values.length, width),
    rows - 1 - Math.round((Math.min(max, Math.max(0, values[i] ?? 0)) / max) * (rows - 1)),
  ]
  let [x0, y0] = point(0)
  grid[y0 * cols + x0] = 1
  for (let i = 1; i < values.length; i += 1) {
    const [x1, y1] = point(i)
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let s = 1; s <= steps; s += 1) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps)
      const y = Math.round(y0 + ((y1 - y0) * s) / steps)
      grid[y * cols + x] = 1
    }
    x0 = x1
    y0 = y1
  }
  return grid
}

type Cell = { char: string; color: string; hoverId?: string; detail?: string }

function cellsToItems(cells: readonly Cell[], blank: string): RowItem[] {
  const items: RowItem[] = []
  for (const cell of cells) {
    const color = cell.char === ' ' && !cell.hoverId ? blank : cell.color
    const last = items[items.length - 1]
    if (last && last.color === color && last.hoverId === cell.hoverId) {
      last.text += cell.char
    } else {
      items.push({
        text: cell.char,
        color,
        ...(items.length > 0 ? { tight: true } : {}),
        ...(cell.hoverId ? { hoverId: cell.hoverId } : {}),
        ...(cell.detail ? { detail: cell.detail } : {}),
      })
    }
  }
  return items
}

export function lineChart(series: readonly Series[], width: number, height: number, blank: string): RowItem[][] {
  const grids = series.map(s => plot(s.values, width, height, s.max))
  const cols = width * 2
  const lines: RowItem[][] = []
  for (let row = 0; row < height; row += 1) {
    const cells: Cell[] = []
    for (let cell = 0; cell < width; cell += 1) {
      let bits = 0
      let color = blank
      grids.forEach((grid, g) => {
        let own = 0
        for (let dx = 0; dx < 2; dx += 1) {
          for (let dy = 0; dy < 4; dy += 1) {
            if (grid[(row * 4 + dy) * cols + cell * 2 + dx]) own |= DOT[dx]?.[dy] ?? 0
          }
        }
        if (own && color === blank) color = series[g]?.color ?? blank
        bits |= own
      })
      cells.push({ char: bits ? String.fromCodePoint(BRAILLE_BASE + bits) : ' ', color })
    }
    lines.push(cellsToItems(cells, blank))
  }
  return lines
}

export function markerRow(count: number, marked: readonly number[], width: number, mark: string, color: string, blank: string): RowItem[] {
  const cells = Array.from({ length: width }, () => ({ char: ' ', color: blank }))
  for (const i of marked) {
    const cell = cells[Math.floor(dotColumn(i, count, width) / 2)]
    if (cell) Object.assign(cell, { char: mark, color })
  }
  return cellsToItems(cells, blank)
}

export type SplitBar = { up: number; down: number; id: string; detail: string }

export function splitBars(
  bars: readonly (SplitBar | null)[],
  barWidth: number,
  half: number,
  colors: { up: string; down: string; axis: string; blank: string },
): RowItem[][] {
  const max = Math.max(0, ...bars.map(b => Math.max(b?.up ?? 0, b?.down ?? 0)))
  const eighths = (value: number) => (max > 0 && value > 0 ? Math.max(1, Math.round((value / max) * half * 8)) : 0)
  const UPPER = [' ', '▔', '▔', '▀', '▀', '▀', '▀', '█', '█'] as const
  const rows: RowItem[][] = []
  for (let row = 0; row < half * 2 + 1; row += 1) {
    const cells: Cell[] = []
    for (const bar of bars) {
      let char = row === half ? '─' : ' '
      let color = row === half ? colors.axis : colors.blank
      if (bar && row < half) {
        const fill = Math.min(8, Math.max(0, eighths(bar.up) - (half - 1 - row) * 8))
        if (fill > 0) {
          char = EIGHTHS[fill] ?? ' '
          color = colors.up
        }
      } else if (bar && row > half) {
        const fill = Math.min(8, Math.max(0, eighths(bar.down) - (row - half - 1) * 8))
        if (fill > 0) {
          char = UPPER[fill] ?? ' '
          color = colors.down
        }
      }
      const tag = bar ? { hoverId: bar.id, detail: bar.detail } : {}
      for (let w = 0; w < barWidth; w += 1) cells.push({ char, color, ...tag })
      cells.push({ char: row === half ? '─' : ' ', color: row === half ? colors.axis : colors.blank })
    }
    rows.push(cellsToItems(cells, colors.blank))
  }
  return rows
}

export type StackedBar = { parts: readonly { value: number; color: string }[]; id: string; detail: string }

export function stackedBars(bars: readonly (StackedBar | null)[], barWidth: number, height: number, blank: string): RowItem[][] {
  const total = (bar: StackedBar | null) => bar?.parts.reduce((sum, p) => sum + p.value, 0) ?? 0
  const max = Math.max(0, ...bars.map(total))
  const columns = bars.map(bar => {
    const cells: string[] = []
    if (!bar || max === 0) return cells
    const tall = Math.max(1, Math.round((total(bar) / max) * height))
    const shares = bar.parts.map(p => (p.value > 0 ? Math.max(1, Math.round((p.value / total(bar)) * tall)) : 0))
    while (shares.reduce((a, b) => a + b, 0) > tall) {
      const biggest = shares.indexOf(Math.max(...shares))
      shares[biggest] = (shares[biggest] ?? 1) - 1
    }
    bar.parts.forEach((p, i) => {
      for (let n = 0; n < (shares[i] ?? 0); n += 1) cells.push(p.color)
    })
    return cells
  })
  const rows: RowItem[][] = []
  for (let row = 0; row < height; row += 1) {
    const fromBottom = height - 1 - row
    const cells: Cell[] = []
    bars.forEach((bar, i) => {
      const color = columns[i]?.[fromBottom]
      const tag = bar ? { hoverId: bar.id, detail: bar.detail } : {}
      for (let w = 0; w < barWidth; w += 1) cells.push({ char: color ? '█' : ' ', color: color ?? blank, ...tag })
      cells.push({ char: ' ', color: blank })
    })
    rows.push(cellsToItems(cells, blank))
  }
  return rows
}

export type Mark = { char: string; color: string; id: string; detail: string }

export function markColumns(marks: readonly (Mark | null)[], barWidth: number, blank: string): RowItem[] {
  const cells: Cell[] = []
  const left = Math.floor((barWidth - 1) / 2)
  for (const mark of marks) {
    const tag = mark ? { hoverId: mark.id, detail: mark.detail } : {}
    for (let w = 0; w < barWidth; w += 1) {
      cells.push(mark && w === left ? { char: mark.char, color: mark.color, ...tag } : { char: ' ', color: blank, ...tag })
    }
    cells.push({ char: ' ', color: blank })
  }
  return cellsToItems(cells, blank)
}

export type ColumnBar = { value: number; color: string; id: string; detail: string }

export function columnBars(bars: readonly ColumnBar[], slots: number, barWidth: number, height: number, blank: string): RowItem[][] {
  const shown = bars.slice(-slots)
  const max = Math.max(0, ...shown.map(b => b.value))
  const lines: RowItem[][] = []
  for (let row = 0; row < height; row += 1) {
    const fromBottom = height - 1 - row
    const cells: Cell[] = []
    for (let slot = 0; slot < slots; slot += 1) {
      const bar = shown[slot]
      const eighths = bar && max > 0 && bar.value > 0 ? Math.max(1, Math.round((bar.value / max) * height * 8)) : 0
      const fill = Math.min(8, Math.max(0, eighths - fromBottom * 8))
      const char = bar && fromBottom === 0 && fill === 0 ? '▁' : (EIGHTHS[fill] ?? ' ')
      const tag = bar ? { hoverId: bar.id, detail: bar.detail } : {}
      for (let w = 0; w < barWidth; w += 1) cells.push({ char, color: bar && fill === 0 ? blank : (bar?.color ?? blank), ...tag })
      cells.push({ char: ' ', color: blank })
    }
    lines.push(cellsToItems(cells, blank))
  }
  return lines
}

export function barChart(values: readonly (number | null)[], barWidth: number, height: number, color: string, blank: string): RowItem[][] {
  const max = Math.max(0, ...values.map(v => v ?? 0))
  const lines: RowItem[][] = []
  for (let row = 0; row < height; row += 1) {
    const fromBottom = height - 1 - row
    const cells: Cell[] = []
    for (const v of values) {
      const eighths = max > 0 && v ? Math.max(1, Math.round((v / max) * height * 8)) : 0
      const fill = Math.min(8, Math.max(0, eighths - fromBottom * 8))
      const char = v === null && fromBottom === 0 ? '·' : (EIGHTHS[fill] ?? ' ')
      cells.push({ char, color: v === null ? blank : color })
      for (let gap = 1; gap < barWidth; gap += 1) cells.push({ char: ' ', color: blank })
    }
    lines.push(cellsToItems(cells, blank))
  }
  return lines
}
