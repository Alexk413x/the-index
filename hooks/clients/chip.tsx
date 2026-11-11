import type { ClientModule } from 'claude-code'

type ChipProps = {
  text: string
  color: string
  look?: 'button' | 'link'
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
  if (props.parts) {
    return (
      <Box flexDirection="row">
        {props.parts.map((part, i) => (
          <Text
            key={`part${i}`}
            color={part.color}
            inverse={part.inverse === true}
            bold={part.bold === true}
            underline={isHovered || props.isActive === true}
          >
            {part.text}
          </Text>
        ))}
      </Box>
    )
  }
  return props.look === 'link' ? (
    <Text color={props.color} underline={isHovered} bold={props.isBold === true}>
      {props.text}
    </Text>
  ) : (
    <Text color={props.color} inverse={isHovered || props.isActive === true}>
      {props.text}
    </Text>
  )
}

export default Chip
