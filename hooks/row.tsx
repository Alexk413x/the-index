import type { ClientModule } from 'claude-code'

type RowItem = { text: string; color: string; pick?: string; pad?: number }
type RowProps = { lines: RowItem[][]; hoverColor: string; fade: boolean; closing?: boolean; target: string }
type RowState = { step: number; goal: number; skip: boolean; hovered: string | null; focus: number }

const GAP = '  '
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

function pickAt(lines: RowItem[][], x: number, y: number): string | null {
  let col = 0
  for (const item of lines[y] ?? []) {
    if (x >= col && x < col + item.text.length) return item.pick ?? null
    col += item.text.length + (item.pad ?? 0) + GAP.length
  }
  return null
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
        const hovered = pickAt(props.lines, e.x, e.y)
        if (hovered !== state.hovered) surface.setState({ ...state, hovered })
      } else if (e.type === 'up' && e.button === 'left') {
        const pick = pickAt(props.lines, e.x, e.y)
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
  return (
    <Box flexDirection="column">
      {props.lines.map((line, y) => (
        <Box key={`line${y}`} flexDirection="row">
          {line.map((item, i) => (
            <Text
              key={`item${y}-${i}`}
              color={fadeColor(item.pick !== undefined && item.pick === state.hovered ? props.hoverColor : item.color, amount)}
            >
              {i > 0 ? GAP : ''}
              {item.text}
              {' '.repeat(item.pad ?? 0)}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Row
