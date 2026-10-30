import type { PanelView, RowItem } from '../panels'
import { fmtClock } from '../format'
import { MESSAGES_PICK } from './constants'
import type { Kit } from './kit'

export function sessionLines(view: PanelView, kit: Kit): RowItem[][] {
  const { cfg } = view
  const { note, title, middle } = kit
  const host = view.host
  if (!host) return []
  const value = (text: string, color = cfg.colors.session): RowItem => ({ text, color })
  const messages: RowItem = { text: 'Open Messages', color: cfg.colors.branch, pick: MESSAGES_PICK, link: true }
  const rows: [string, RowItem[], RowItem | null][] = [
    ['Name', [host.title ? value(host.title) : note('untitled')], host.messages ? messages : null],
    [
      'Session',
      [host.sessionName ? { ...value(host.sessionName), pick: 'name', link: true } : value('unnamed'), note('·'), value(host.sessionId ?? '')],
      view.startedAt === null ? null : note(`started ${fmtClock(view.startedAt)}`),
    ],
  ]
  rows.push([
    'Agent',
    [value(host.agent || 'none', host.agent ? cfg.colors.model : cfg.colors.icons)],
    host.agent ? note(view.agentColor ? `colour ${view.agentColor}` : 'no colour') : null,
  ])
  if (host.bridgeId) {
    rows.push([
      'Remote',
      [value(host.bridgeId, view.attached ? cfg.colors.good : cfg.colors.session)],
      note(view.attached ? `${view.attached} attached` : 'none attached'),
    ])
  }
  rows.push(['Folder', [value(host.cwd ?? '')], note(`Claude Code ${host.version ?? ''}`)])
  return rows.map(([label, values, extra]) => [title(label), ...middle(values), ...(extra ? [extra] : [])])
}
