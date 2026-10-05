import { describe, expect, test } from 'claude-code/testing'

import { agentColorKey, parseAgentFile } from '../hooks/agents'
import { EMPTY_TOTALS, MAIN, PRIMARY_DEFAULT, buildLines, dimHex, lineText, readConfig, tint } from '../hooks/format'

describe('agent files', () => {
  test('the frontmatter gives the name and colour', () => {
    expect(parseAgentFile('---\nname: reviewer\ndescription: Reviews\ncolor: Blue\n---\nbody', 'x.md')).toEqual({
      name: 'reviewer',
      color: 'blue',
    })
    expect(parseAgentFile('\uFEFF---\r\nname: "quoted"\r\ncolor: \'pink\'\r\n---\r\n', 'x.md')).toEqual({ name: 'quoted', color: 'pink' })
  })

  test('a missing name falls back to the file name, and an unknown colour is no colour', () => {
    expect(parseAgentFile('---\ncolor: teal\n---\n', 'helper.md')).toEqual({ name: 'helper' })
    expect(parseAgentFile('no frontmatter', 'helper.md')).toBeNull()
  })

  test('a colour becomes the theme key Claude Code draws agents in', () => {
    expect(agentColorKey('purple')).toBe('purple_FOR_SUBAGENTS_ONLY')
    expect(agentColorKey('teal')).toBeUndefined()
    expect(agentColorKey(undefined)).toBeUndefined()
  })
})

describe('primary colour', () => {
  test('the values are orange by default and follow the primary colour the person sets', () => {
    expect(readConfig({}).colors.model).toBe(dimHex(PRIMARY_DEFAULT, 0.95))
    const green = readConfig({ color_primary: '#00ff00' })
    expect(green.colors.model).toBe(dimHex('#00ff00', 0.95))
    expect(green.colors.branch).toBe(dimHex('#00ff00', 0.95))
    expect(green.colors.high).toBe(dimHex('#d75f00', 0.95))
  })

  test('a segment colour left at the orange default follows the primary; another colour overrides it', () => {
    const cfg = readConfig({ color_primary: '#00ff00', color_model: '#d75f00', color_session: '#ffffff' })
    expect(cfg.colors.model).toBe(dimHex('#00ff00', 0.95))
    expect(cfg.colors.session).toBe(dimHex('#ffffff', 0.95))
    expect(cfg.tinted).toContain('model')
    expect(cfg.tinted).not.toContain('session')
  })
})

describe('agent tint', () => {
  test('the lines follow the prompt border by default', () => {
    expect(readConfig({}).colors.rules).toBe('promptBorder')
    expect(readConfig({ color_rules: '#000000' }).colors.rules).toBe('#000000')
  })

  test('an agent colour replaces the default orange and the lines, not levels or colours the person set', () => {
    const cfg = readConfig({ color_session: '#d75f00', color_project: '#00ff00', color_rules: '#111111' })
    const tinted = tint(cfg, 'blue_FOR_SUBAGENTS_ONLY')
    expect(tinted.colors.model).toBe('blue_FOR_SUBAGENTS_ONLY')
    expect(tinted.colors.session).toBe('blue_FOR_SUBAGENTS_ONLY')
    expect(tinted.colors.project).toBe(dimHex('#00ff00', 0.95))
    expect(tinted.colors.rules).toBe(dimHex('#111111', 0.95))
    expect(tinted.colors.high).toBe(cfg.colors.high)
    expect(tinted.colors.good).toBe(cfg.colors.good)
    expect(tint(cfg, undefined)).toBe(cfg)
  })

  test('line 1 shows the harness, then the agent, then the model', () => {
    const snap = {
      now: 0,
      agents: { [MAIN]: { model: 'claude-opus-5-5', effort: 'high' as const } },
      turn: null,
      totals: EMPTY_TOTALS,
      usage: null,
      git: null,
      host: { sessionName: '', bridged: false, ide: '', agent: 'reviewer', project: '' },
      clients: 0,
      agentEfforts: {},
      agentModels: {},
    }
    expect(lineText(buildLines(snap, readConfig({}))[0] ?? [])).toStartWith('Claude reviewer Opus 5.5 high | ')
    const plain = { ...snap, host: { ...snap.host, agent: '' } }
    expect(lineText(buildLines(plain, readConfig({}))[0] ?? [])).toStartWith('Claude Opus 5.5 high | ')
  })
})
