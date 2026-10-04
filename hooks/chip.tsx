import type { ClientModule } from 'claude-code'

type ChipProps = { text: string; color: string; look?: 'button' | 'link'; isActive?: boolean; href?: string }
type ChipState = { isHovered: boolean }

const Chip: ClientModule<ChipProps, ChipState> = (props, surface) => {
  const { Text } = surface.elements
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
      else if (e.type === 'up' && e.button === 'left') surface.post(props.href ? { press: true, href: props.href } : { press: true })
    })
    surface.onKey(k => {
      if (k.key === 'return' || k.key === ' ') surface.post(props.href ? { press: true, href: props.href } : { press: true })
    })
  }
  const isHovered = surface.state?.isHovered === true
  return props.look === 'link' ? (
    <Text color={props.color} underline={isHovered}>
      {props.text}
    </Text>
  ) : (
    <Text color={props.color} inverse={isHovered || props.isActive === true}>
      {props.text}
    </Text>
  )
}

export default Chip
