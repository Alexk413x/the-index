import type { ClientModule } from 'claude-code'

type ChipProps = {
  text: string
  color: string
  isActive?: boolean
  isBold?: boolean
  parts?: { text: string; color: string; inverse?: boolean; bold?: boolean }[]
}
type ChipState = { isHovered: boolean }

const Chip: ClientModule<ChipProps, ChipState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ isHovered: false })
    surface.onPointer(e => {
      if (e.type === 'enter') {
        surface.setState({ isHovered: true })
        surface.post({ hover: true })
      } else if (e.type === 'leave') {
        surface.setState({ isHovered: false })
        surface.post({ hover: false })
      }
      else if (e.type === 'up' && e.button === 'left') surface.post({ press: true })
    })
    surface.onKey(k => {
      if (k.key === 'return' || k.key === ' ') surface.post({ press: true })
    })
  }
  const isHovered = surface.state?.isHovered === true
  const isActive = props.isActive === true
  const parts = props.parts ?? [{ text: props.text, color: props.color, bold: props.isBold === true }]
  return (
    <Box flexDirection="row">
      {parts.map((part, i) => (
        <Text
          key={`part${i}`}
          color={part.color}
          inverse={isHovered !== (part.inverse === true)}
          bold={part.bold === true}
          underline={isActive}
        >
          {part.text}
        </Text>
      ))}
    </Box>
  )
}

export default Chip
