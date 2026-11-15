import type { PanelView, RowItem } from '../panels'
import { fmtClock } from '../format'
import { COPY_PICK, MESSAGES_PICK } from './constants'
import type { Kit } from './kit'

type CopyField = 'title' | 'name' | 'id' | 'remote'

function copyValue(host: NonNullable<PanelView['host']>, field: CopyField): string {
  if (field === 'title') return host.title ?? ''
  if (field === 'name') return host.sessionName
  if (field === 'id') return host.sessionId ?? ''
  return host.bridgeId ?? ''
}

export function sessionCopyText(host: PanelView['host'], pick: string): string {
  if (!host || !pick.startsWith(COPY_PICK)) return ''
  const field = pick.slice(COPY_PICK.length)
  return field === 'title' || field === 'name' || field === 'id' || field === 'remote' ? copyValue(host, field) : ''
}

export function sessionLines(view: PanelView, kit: Kit): RowItem[][] {
  const { cfg } = view
  const { note, title, middle } = kit
  const host = view.host
  if (!host) return []
  const value = (text: string, color = cfg.colors.session): RowItem => ({ text, color })
  const copyable = (field: CopyField, color = cfg.colors.session): RowItem => ({ ...value(copyValue(host, field), color), pick: `${COPY_PICK}${field}` })
  const messages: RowItem = { text: 'Open Messages', color: cfg.colors.branch, pick: MESSAGES_PICK }
  const rows: [string, RowItem[], RowItem | null][] = [
    ['Name', [host.title ? copyable('title') : note('untitled')], host.messages ? messages : null],
    [
      'Session',
      [host.sessionName ? copyable('name') : value('unnamed'), note('·'), host.sessionId ? copyable('id') : value('')],
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
      [copyable('remote', view.attached ? cfg.colors.good : cfg.colors.session)],
      note(view.attached ? `${view.attached} attached` : 'none attached'),
    ])
  }
  rows.push(['Folder', [value(host.cwd ?? '')], note(`Claude Code ${host.version ?? ''}`)])
  return rows.map(([label, values, extra]) => [title(label), ...middle(values), ...(extra ? [extra] : [])])
}
