const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] as const

export type AgentColor = (typeof AGENT_COLORS)[number]

function isAgentColor(value: unknown): value is AgentColor {
  return typeof value === 'string' && (AGENT_COLORS as readonly string[]).includes(value)
}

// Claude Code's theme names each agent colour `<colour>_FOR_SUBAGENTS_ONLY`; a Text colour
// may be a theme key, so the band follows the person's theme as the prompt does.
export function agentColorKey(color: string | undefined): string | undefined {
  return isAgentColor(color) ? `${color}_FOR_SUBAGENTS_ONLY` : undefined
}

export function parseAgentFile(text: string, fileName: string): { name: string; color?: AgentColor } | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const fields = new Map<string, string>()
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (m?.[1]) fields.set(m[1], (m[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2'))
  }
  const name = fields.get('name') || fileName.replace(/\.md$/i, '')
  const color = fields.get('color')?.toLowerCase()
  return isAgentColor(color) ? { name, color } : { name }
}
