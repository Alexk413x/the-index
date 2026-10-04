import type { RowItem } from './panels'

export type Series = { values: readonly number[]; color: string }

const BRAILLE_BASE = 0x2800
// Braille dot bits by [column][row from the top] of a 2×4 cell.
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const
const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

function plot(values: readonly number[], width: number, height: number): Uint8Array {
  const cols = width * 2
  const rows = height * 4
  const grid = new Uint8Array(cols * rows)
  const max = Math.max(0, ...values)
  if (values.length === 0 || max <= 0) return grid
  const point = (i: number): [number, number] => [
    values.length === 1 ? Math.floor((cols - 1) / 2) : Math.round((i * (cols - 1)) / (values.length - 1)),
    rows - 1 - Math.round((Math.max(0, values[i] ?? 0) / max) * (rows - 1)),
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

function cellsToItems(cells: readonly { char: string; color: string }[], blank: string): RowItem[] {
  const items: RowItem[] = []
  for (const cell of cells) {
    const color = cell.char === ' ' ? blank : cell.color
    const last = items[items.length - 1]
    if (last && last.color === color) last.text += cell.char
    else items.push({ text: cell.char, color, ...(items.length > 0 ? { tight: true } : {}) })
  }
  return items
}

export function lineChart(series: readonly Series[], width: number, height: number, blank: string): RowItem[][] {
  const grids = series.map(s => plot(s.values, width, height))
  const cols = width * 2
  const lines: RowItem[][] = []
  for (let row = 0; row < height; row += 1) {
    const cells: { char: string; color: string }[] = []
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

export function barChart(values: readonly (number | null)[], barWidth: number, height: number, color: string, blank: string): RowItem[][] {
  const max = Math.max(0, ...values.map(v => v ?? 0))
  const lines: RowItem[][] = []
  for (let row = 0; row < height; row += 1) {
    const fromBottom = height - 1 - row
    const cells: { char: string; color: string }[] = []
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
