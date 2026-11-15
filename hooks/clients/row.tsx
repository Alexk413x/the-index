import type { ClientModule } from 'claude-code'

import type { RowItem } from '../lib/panels'

type RowProps = { lines: RowItem[][]; gap: number; target: string }
type RowState = { hovered: string | null; focus: number }

const IDLE: RowState = { hovered: null, focus: 0 }

function itemAt(lines: RowItem[][], gap: number, x: number, y: number): RowItem | null {
  let col = 0
  for (const [i, item] of (lines[y] ?? []).entries()) {
    if (i > 0 && !item.tight) col += gap
    if (x >= col && x < col + item.text.length) return item
    col += item.text.length + (item.pad ?? 0)
  }
  return null
}

function hoverKey(item: RowItem | null): string | null {
  return item?.pick ?? item?.hoverId ?? null
}

const Row: ClientModule<RowProps, RowState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const picks = props.lines.flat().flatMap(item => (item.pick ? [item.pick] : []))

  // Set on every call, not once: a call with new props would otherwise leave the listeners
  // reading the first props (an old target, stale picks and links).
  surface.onPointer(e => {
    const state = surface.state ?? IDLE
    if (e.type === 'enter') {
      surface.post({ hover: true })
    } else if (e.type === 'leave') {
      surface.setState({ ...state, hovered: null })
      surface.post({ hover: false })
    } else if (e.type === 'move') {
      const hovered = hoverKey(itemAt(props.lines, props.gap, e.x, e.y))
      if (hovered !== state.hovered) surface.setState({ ...state, hovered })
    } else if (e.type === 'up' && e.button === 'left') {
      const pick = itemAt(props.lines, props.gap, e.x, e.y)?.pick
      if (pick) surface.post({ pick, target: props.target })
    }
  })
  surface.onKey(k => {
    const state = surface.state ?? IDLE
    if (picks.length === 0) return
    if (k.key === 'right' || k.key === 'left') {
      const focus = (state.focus + (k.key === 'right' ? 1 : picks.length - 1)) % picks.length
      surface.setState({ ...state, focus, hovered: picks[focus] ?? null })
    } else if (k.key === 'return' || k.key === ' ') {
      const pick = picks[state.focus]
      if (pick) surface.post({ pick, target: props.target })
    }
  })

  const state = surface.state ?? IDLE
  const detail = state.hovered === null ? undefined : props.lines.flat().find(item => hoverKey(item) === state.hovered && item.detail)?.detail
  const partsFor = (item: RowItem) => (item.footer && state.hovered !== null ? item.details?.[state.hovered] : undefined)
  return (
    <Box flexDirection="column">
      {props.lines.map((line, y) => (
        <Box key={`line${y}`} flexDirection="row">
          {line.flatMap((item, i) => {
            const parts = partsFor(item)
            const swap = state.hovered === null ? undefined : item.swaps?.[state.hovered]
            const body = parts
              ? parts.map((part, p) => (
                  <Text key={`part${y}-${i}-${p}`} color={part.color}>
                    {part.text}
                  </Text>
                ))
              : [
                  <Text key={`item${y}-${i}`} color={swap?.color ?? item.color} inverse={hoverKey(item) !== null && hoverKey(item) === state.hovered}>
                    {item.footer && detail !== undefined ? detail : (swap?.text ?? item.text)}
                  </Text>,
                ]
            return [
              <Text key={`gap${y}-${i}`}>{i > 0 && !item.tight ? ' '.repeat(props.gap) : ''}</Text>,
              ...body,
              <Text key={`pad${y}-${i}`}>{' '.repeat((item.pad ?? 0) + (item.footer && detail !== undefined ? Math.max(0, item.text.length - detail.length) : 0))}</Text>,
            ]
          })}
        </Box>
      ))}
    </Box>
  )
}

export default Row
