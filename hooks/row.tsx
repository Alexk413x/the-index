import type { ClientModule } from 'claude-code'

import type { RowItem } from './panels'

type RowProps = { lines: RowItem[][]; gap: number; hoverColor: string; fade: boolean; closing?: boolean; target: string }
type RowState = { step: number; goal: number; skip: boolean; hovered: string | null; focus: number }

const FADE_STEPS = 10
const FADE_FRAME_MS = 30
const IDLE: RowState = { step: FADE_STEPS, goal: FADE_STEPS, skip: false, hovered: null, focus: 0 }

function fadeColor(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m?.[1] || amount >= 1) return hex
  const n = parseInt(m[1], 16)
  const scale = 0.2 + 0.8 * amount
  return `#${[16, 8, 0].map(shift => Math.round(((n >> shift) & 255) * scale).toString(16).padStart(2, '0')).join('')}`
}

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

  const first: RowState = props.fade ? { ...IDLE, step: 0 } : IDLE
  if (surface.state === undefined) {
    surface.setState(first)
    surface.every(FADE_FRAME_MS, () => {
      const state = surface.state ?? IDLE
      if (state.step < state.goal) {
        surface.setState({ ...state, step: state.step + 1 })
      } else if (state.step > state.goal) {
        if (state.skip) {
          surface.setState({ ...state, skip: false })
        } else {
          const step = state.step - 1
          surface.setState({ ...state, step, skip: true })
          if (step === 0) surface.post({ faded: true })
        }
      }
    })
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
  }

  const state = surface.state ?? first
  const goal = props.closing ? 0 : FADE_STEPS
  if (state.goal !== goal) {
    surface.setState(goal === FADE_STEPS ? { ...state, goal, step: FADE_STEPS } : { ...state, goal })
  }
  const amount = state.step / FADE_STEPS
  const detail = state.hovered === null ? undefined : props.lines.flat().find(item => hoverKey(item) === state.hovered && item.detail)?.detail
  return (
    <Box flexDirection="column">
      {props.lines.map((line, y) => (
        <Box key={`line${y}`} flexDirection="row">
          {line.map((item, i) => (
            <Text
              key={`item${y}-${i}`}
              color={fadeColor(hoverKey(item) !== null && hoverKey(item) === state.hovered ? props.hoverColor : item.color, amount)}
              underline={item.pick !== undefined && item.pick === state.hovered}
            >
              {i > 0 && !item.tight ? ' '.repeat(props.gap) : ''}
              {item.footer && detail !== undefined ? detail : item.text}
              {' '.repeat(item.pad ?? 0)}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Row
