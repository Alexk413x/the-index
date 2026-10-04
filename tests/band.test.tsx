import { expect, mock, test, type MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ROW_GAP, TITLE_WIDTH } from '../hooks/panels'

const SURFACES = ['terminal', 'desktop'] as const
const START = 1_800_000_000_000

const seenEfforts: (string | number | undefined)[] = []
const seenModels: string[] = []
const commands: string[] = []
const toasts: string[] = []
let stepsFail = false
let sessionModel = 'claude-opus-5-5'
let extraSettings: Record<string, unknown> = {}
let clock: MockClock

function engine(on: On) {
  seenEfforts.length = 0
  seenModels.length = 0
  commands.length = 0
  toasts.length = 0
  stepsFail = false
  sessionModel = 'claude-opus-5-5'
  extraSettings = {}
  on('command.run', ($, e) => {
    commands.push(`${e.command} ${e.args}`)
    if (e.command === 'model') {
      const ids: Record<string, string> = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5-20251001', default: 'claude-opus-5-5' }
      sessionModel = ids[e.args] ?? sessionModel
      const names: Record<string, string> = { sonnet: 'Sonnet 5.5', haiku: 'Haiku 4.5', default: 'Opus 5.5 (default)' }
      return { text: `Set model to \`${names[e.args] ?? e.args}\` for this session only` }
    }
    return { text: `Set effort level to ${e.args} (this session only): details` }
  })
  on('session.model', () => ({ value: sessionModel }))
  on('settings.read', () => ({
    value: {
      modelSettings: { 'claude-fable-5-1': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { effortLevel: 'xhigh' } },
      ...extraSettings,
    },
  }))
  on('ui.toast', ($, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  clock = mock.clock(on, { now: START + 60_000 })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.usage', ($, e) => ({
    value: {
      startedAt: START,
      context: {
        window: 200_000,
        percent: 12,
        tokens: 24_000,
        ...((e as { breakdown?: string }).breakdown ? { breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: 160_000 } } : {}),
      },
      rateLimits: [],
      cost: { usd: 0.25 },
    } as never,
  }))
  on('session.compact', ($, e) => ({ messages: e.messages }))
  on('session.measure', () => ({ changed: [] }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Scan the repo', type: 'Explore', status: 'running' }],
  }))
  on('turn.step', async function* ($, e) {
    seenEfforts.push(e.effort)
    seenModels.push(e.model)
    if (stepsFail) return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: e.model,
        input_tokens: 10,
        output_tokens: 200,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 990,
      },
    }
  })
}

type Run = { exitCode?: number; stdout?: string }

type StartOptions = {
  cwd?: string
  id?: string
  env?: Record<string, string>
  run?: (argv: readonly string[], env: unknown) => Run
  sessionFile?: unknown
  files?: Record<string, string>
}

async function startSession($: { session: { start: (e: never) => Promise<unknown> } }, on: On, opts: StartOptions = {}) {
  const cwd = opts.cwd ?? 'C:/work/app'
  on('session.start', () => ({ cwd }))
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: opts.id ?? 'abc' }))
  on('session.version', () => ({ value: { version: '2.1.288' } }) as never)
  on('process.run', ($, e) => {
    const { argv, init } = e as { argv: readonly string[]; init?: { env?: unknown } }
    const r = opts.run?.(argv, init?.env) ?? {}
    return {
      value: { exitCode: r.exitCode ?? 1, stdout: r.stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  mock.env(on, opts.env ?? { USERPROFILE: 'C:/nobody' })
  const entry = (name: string) => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })
  on('fs.list', ($, e) => {
    const path = String((e as { path?: string }).path).replace(/\\/g, '/')
    if (opts.sessionFile !== undefined && /sessions$/.test(path)) return { value: [entry('1.json')] } as never
    if (path === 'C:/nobody/.claude/agents') return { value: Object.keys(opts.files ?? {}).filter(n => n.endsWith('.md')).map(entry) } as never
    return { value: [] }
  })
  on('fs.read', ($, e) => {
    const path = String((e as { path?: string }).path).replace(/\\/g, '/')
    const file = Object.entries(opts.files ?? {}).find(([name]) => path.endsWith(`/${name}`))
    if (file) return { value: file[1] }
    if (opts.sessionFile !== undefined && /sessions/.test(path)) return { value: JSON.stringify(opts.sessionFile) }
    throw new Error(`ENOENT ${path}`)
  })
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true } as never)
}

async function step(
  $: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> } },
  model: string,
  effort: string,
  agentId?: string,
) {
  const e = { turnId: 't', index: 0, model, effort, messageCount: 1, ...(agentId ? { agentId } : {}) }
  for await (const _ of $.turn.step(e as never)) void _
}

function props(agentId?: string) {
  return {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 200,
    scroll: { offset: 0, bodyRows: 10 },
    view: agentId ? { agentId } : {},
  }
}

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string

function visible(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(visible).join('')
  const n = node as Exclude<Drawn, string> | null
  if (!n || typeof n !== 'object') return ''
  if (n.props?.['display'] === 'none') return ''
  if (n.type === 'Button') return String(n.props?.['label'] ?? '')
  if (n.type === 'Client') return String((n.props?.['props'] as { text?: string } | undefined)?.text ?? '')
  return (n.children ?? []).map(visible).join('')
}

async function pinnedOf(band: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, panel: string) {
  const pin = await band.find({ key: `${panel}-pin` })
  return (pin?.props['props'] as { text?: string } | undefined)?.text === '■'
}

async function bandText(mounted: { drawn: () => Promise<unknown> }) {
  return visible(await mounted.drawn())
}

async function blockOrder(band: { drawn: () => Promise<unknown> }) {
  const keys: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as { props?: { key?: string }; children?: unknown[] }
    if (n.props?.key?.endsWith('-block')) keys.push(n.props.key.replace('-block', ''))
    ;(n.children ?? []).forEach(walk)
  }
  walk(await band.drawn())
  return keys
}

test('the band follows the transcript on screen', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  await step($, 'claude-sonnet-5-5', 'low', 'a1')

  for (const surface of SURFACES) {
    const main = await $.ui.mount({ plugin: 'the-index', surface, component: 'AbovePrompt', props: props() })
    const mainText = await bandText(main)
    expect(mainText).toContain('Opus 5.5 high')
    expect(mainText).not.toContain('Sonnet')
    expect(mainText).toContain('↓200')
    await main.unmount()

    const sub = await $.ui.mount({ plugin: 'the-index', surface, component: 'AbovePrompt', props: props('a1') })
    const subText = await bandText(sub)
    expect(subText).toContain('⤷ Explore Scan the repo Sonnet 5.5 low running')
    expect(subText).not.toContain('Opus')
    await sub.unmount()
  }
})

test('an agent the band never saw step shows placeholders', async ($, on) => {
  engine(on)
  const sub = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props('a1') })
  expect(await bandText(sub)).toContain('⤷ Explore Scan the repo ░░ ░░ running')
  await sub.unmount()
})

test('subagent steps leave the main telemetry alone', async ($, on) => {
  engine(on)
  await step($, 'claude-sonnet-5-5', 'low', 'a1')
  const main = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(main)).toContain('Δ ↑░░')
  await main.unmount()
})

test('agent view off keeps the main model', { options: { show_agent_view: false } }, async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const sub = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props('a1') })
  const text = await bandText(sub)
  expect(text).toContain('Opus 5.5 high')
  expect(text).not.toContain('Explore')
  await sub.unmount()
})

test('a survey takes the band', async ($, on) => {
  engine(on)
  const band = await $.ui.mount({
    plugin: 'the-index',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...props(), hasSurvey: true },
  })
  expect(await band.find({ type: 'Text', text: /Δ/ })).toBeUndefined()
  await band.unmount()
})

test('the effort picker runs /effort for the main session and overrides a subagent', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')

  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await band.find({ key: 'effort-row' })).toBeUndefined()
  await band.post({ press: true }, { in: 'effort-chip' })
  expect(await pinnedOf(band, 'effort')).toBe(true)
  await band.post({ pick: 'low', target: 'main' }, { in: 'effort-row' })
  expect(await pinnedOf(band, 'effort')).toBe(false)
  expect(await bandText(band)).toContain('Opus 5.5 low')
  await band.post({ press: true }, { in: 'effort-chip' })
  await band.post({ pick: 'default', target: 'main' }, { in: 'effort-row' })
  await band.unmount()
  expect(commands).toEqual(['effort low', 'effort auto'])

  const sub = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props('a1') })
  await sub.post({ press: true }, { in: 'effort-chip' })
  expect((await sub.find({ key: 'effort-row' }))?.props['props']).toMatchObject({ target: 'a1' })
  await sub.post({ pick: 'max', target: 'a1' }, { in: 'effort-row' })
  await sub.unmount()
  await step($, 'claude-sonnet-5-5', 'medium', 'a1')
  expect(seenEfforts[seenEfforts.length - 1]).toBe('max')
  expect(commands).toEqual(['effort low', 'effort auto'])
})

test('/index-effort opens the effort row', async ($, on) => {
  engine(on)
  const result = await $.command.run({ command: 'index-effort', args: '' } as never)
  expect(JSON.stringify(result)).toContain('effort row is open')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await pinnedOf(band, 'effort')).toBe(true)
  await band.unmount()
})

test('hovering a name opens its row after a pause, and leaving closes it after a grace period', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })

  await band.post({ hover: true }, { in: 'model-chip' })
  await clock.advance(50)
  expect(await band.find({ key: 'model-row' })).toBeUndefined()
  await clock.advance(60)
  const row = await band.find({ key: 'model-row' })
  expect(row?.props['props']).toMatchObject({ fade: true })
  const items = (row?.props['props'] as { lines: { text: string; pick?: string }[][] }).lines[0] ?? []
  expect(items.filter(i => i.pick).map(i => i.pick)).toEqual(['fable', 'sonnet', 'haiku'])

  await band.post({ hover: false }, { in: 'model-chip' })
  expect((await band.find({ key: 'model-row' }))?.props['props']).toMatchObject({ closing: true })
  await clock.advance(200)
  await band.post({ hover: true }, { in: 'model-row' })
  expect((await band.find({ key: 'model-row' }))?.props['props']).toMatchObject({ closing: false })
  await clock.advance(400)
  expect(await band.find({ key: 'model-row' })).toBeDefined()

  await band.post({ hover: false }, { in: 'model-row' })
  await clock.advance(310)
  expect(await band.find({ key: 'model-row' })).toBeDefined()
  await band.post({ faded: true }, { in: 'model-row' })
  expect(await band.find({ key: 'model-row' })).toBeUndefined()
  await band.unmount()
})

test('a pick in the hovered model row runs /model and closes the row', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ hover: true }, { in: 'model-chip' })
  await clock.advance(110)
  await band.post({ pick: 'sonnet', target: 'main' }, { in: 'model-row' })
  expect(await bandText(band)).toContain('Sonnet 5.5 xhigh')
  expect(await band.find({ key: 'model-row' })).toBeUndefined()
  await band.unmount()
  expect(commands).toEqual(['model sonnet'])
})

test('a subagent model that does not answer falls back to its own model', async ($, on) => {
  engine(on)
  await step($, 'claude-sonnet-5-5', 'low', 'a1')
  stepsFail = true
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props('a1') })
  await band.post({ press: true }, { in: 'model-chip' })
  await band.post({ pick: 'fable', target: 'a1' }, { in: 'model-row' })
  await band.unmount()
  await step($, 'claude-sonnet-5-5', 'low', 'a1')
  expect(seenModels[seenModels.length - 1]).toBe('claude-fable-5-1')
  const after = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props('a1') })
  expect(await bandText(after)).not.toContain('Fable')
  await after.unmount()
  expect(commands).toEqual([])
})

test('the main view shows the session model live, whatever answered last', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  sessionModel = 'claude-haiku-4-5-20251001'
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('Haiku 4.5')
  await band.unmount()
})

test('a model switch from anywhere moves the band, and its cache TTL is used', async ($, on) => {
  engine(on)
  on('classic.PostModelSwitch', () => ({}))
  await step($, 'claude-opus-5-5', 'high')
  sessionModel = 'claude-haiku-4-5-20251001'
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-haiku-4-5-20251001',
    requested_model: 'haiku',
    source: 'picker',
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: '5m',
    estimated_cache_write_usd: 0,
    pricing: 'catalog',
  } as never)
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  const text = await bandText(band)
  expect(text).toContain('Haiku 4.5')
  expect(text).toContain('☀ 05m')
  await band.unmount()
})

test('a typed /effort moves the band', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  await $.command.run({ command: 'effort', args: 'low' } as never)
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('Opus 5.5 low')
  await band.unmount()
})

test('clicking the folder name opens it in the file manager', async ($, on) => {
  engine(on)
  const runs: (readonly string[])[] = []
  const envs: unknown[] = []
  await startSession($, on, {
    env: { OS: 'Windows_NT' },
    run: (argv, env) => {
      runs.push(argv)
      envs.push(env)
      return { exitCode: 0 }
    },
  })
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  const chip = await band.find({ key: 'project-chip' })
  if (chip) await band.post({ press: true }, { in: 'project-chip' })
  await band.unmount()
  expect(chip).toBeDefined()
  expect(runs).toContainEqual([
    'powershell',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(New-Object -ComObject Shell.Application).Open($env:THE_INDEX_OPEN)',
  ])
  expect(envs).toContainEqual({ THE_INDEX_OPEN: 'C:\\work\\app' })
})

test('rows keep their place: a new pin goes to the bottom, an unpinned row stays put until it hides', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ press: true }, { in: 'effort-chip' })
  await band.post({ press: true }, { in: 'model-chip' })
  expect(await blockOrder(band)).toEqual(['effort', 'model'])
  expect((await band.find({ key: 'model-chip' }))?.props['props']).toMatchObject({ isActive: true })

  await band.post({ hover: true }, { in: 'effort-pin' })
  await band.post({ press: true }, { in: 'effort-pin' })
  expect(await blockOrder(band)).toEqual(['effort', 'model'])
  expect(await pinnedOf(band, 'effort')).toBe(false)

  await band.post({ hover: false }, { in: 'effort-pin' })
  await clock.advance(1010)
  expect(await blockOrder(band)).toEqual(['model'])

  await band.post({ press: true }, { in: 'effort-chip' })
  expect(await blockOrder(band)).toEqual(['model', 'effort'])
  await band.post({ press: true }, { in: 'model-pin' })
  expect(await blockOrder(band)).toEqual(['effort'])
  await band.unmount()
})

test('the effort shows before the first request, from the saved setting for the model', async ($, on) => {
  engine(on)
  sessionModel = 'claude-sonnet-5-5'
  await startSession($, on)
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('Sonnet 5.5 xhigh')
  await band.unmount()
})

test('moving from the name onto its row keeps the row, whichever message arrives first', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ hover: true }, { in: 'effort-chip' })
  await clock.advance(110)
  await band.post({ hover: true }, { in: 'effort-row' })
  await band.post({ hover: false }, { in: 'effort-chip' })
  await clock.advance(400)
  expect((await band.find({ key: 'effort-row' }))?.props['props']).toMatchObject({ closing: false })
  await band.post({ hover: false }, { in: 'effort-row' })
  await clock.advance(1010)
  expect(await band.find({ key: 'effort-row' })).toBeUndefined()
  await band.unmount()
})

test('the harness name lists agent-tabs harnesses and a pick opens one in a new tab', async ($, on) => {
  engine(on)
  const calls: unknown[] = []
  on('mcp.call', ($, e) => {
    calls.push(e)
    const text = JSON.stringify({
      default: 'claude',
      agents: [
        { name: 'claude', label: 'Claude Code', installed: true },
        { name: 'codex', label: 'Codex', installed: true },
        { name: 'gemini', label: 'Gemini CLI', installed: false },
      ],
    })
    return { value: { content: [{ type: 'text', text }], isError: false } } as never
  })
  await startSession($, on)
  await step($, 'claude-opus-5-5', 'high')

  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('Claude Opus 5.5 high')
  await band.post({ hover: true }, { in: 'harness-chip' })
  await clock.advance(110)
  const row = await band.find({ key: 'harness-row' })
  const items = (row?.props['props'] as { lines: { text: string; pick?: string }[][] }).lines[0] ?? []
  expect(items.filter(i => i.pick).map(i => i.text)).toEqual(['Claude Code', 'Codex'])
  await band.post({ pick: 'codex', target: 'main' }, { in: 'harness-row' })
  await band.unmount()
  expect(calls).toContainEqual(expect.objectContaining({ tool: 'open_tab', args: { agent: 'codex', path: 'C:/work/app' } }))
})

test('default has its own column, is orange when in use, and a pick runs the default', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ hover: true }, { in: 'model-chip' })
  await clock.advance(110)
  const items = ((await band.find({ key: 'model-row' }))?.props['props'] as { lines: { text: string; pick?: string }[][] })
    .lines[0] ?? []
  const texts = items.map(i => i.text)
  expect(texts[texts.indexOf('Haiku 4.5') + 1]).toBe('default')
  expect(items.find(i => i.text === 'default')?.pick).toBeUndefined()

  await band.post({ hover: true }, { in: 'effort-chip' })
  await clock.advance(110)
  const effortItems = ((await band.find({ key: 'effort-row' }))?.props['props'] as { lines: { text: string; pick?: string }[][] })
    .lines[0] ?? []
  expect(effortItems.find(i => i.text === 'default')?.pick).toBeUndefined()
  await band.post({ pick: 'default', target: 'main' }, { in: 'effort-row' })
  await band.unmount()
  expect(commands).toEqual(['effort auto'])
})

test('the effort and model rows line up their sections', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ press: true }, { in: 'effort-chip' })
  await band.post({ press: true }, { in: 'model-chip' })
  const columns = async (key: string) => {
    const items = ((await band.find({ key }))?.props['props'] as { lines: { text: string; pad?: number }[][] }).lines[0] ?? []
    const starts: number[] = []
    let col = 0
    for (const item of items) {
      if (item.text === 'default' || item.text.startsWith('may re-cache')) starts.push(col)
      col += item.text.length + (item.pad ?? 0) + 2
    }
    return starts
  }
  const rows = (await band.findAll({ type: 'Client' })).filter(c => String(c.props['module']).includes('row'))
  expect(rows).toHaveLength(2)
  const [effortCols, modelCols] = await Promise.all([columns('effort-row'), columns('model-row')])
  expect(effortCols).toEqual(modelCols)
  expect(modelCols).toEqual([10 + 2 + 60 - 'default'.length, 10 + 2 + 60 + 2])
  await band.unmount()
})

test('the ultracode button toggles the keyword in the draft and lights while it is there', async ($, on) => {
  engine(on)
  let draft = 'fix the tests'
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', ($, e) => {
    draft = (e as { text: string }).text
    return { isFilled: true, text: draft, cursor: draft.length } as never
  })
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ press: true }, { in: 'effort-chip' })
  await band.post({ pick: 'ultracode', target: 'main' }, { in: 'effort-row' })
  expect(draft).toBe('fix the tests ultracode')
  const lit = ((await band.find({ key: 'effort-row' }))?.props['props'] as { lines: { text: string; color: string }[][] }).lines[0]
  expect(lit?.find(i => i.text === 'ultracode')?.color).not.toBe(lit?.find(i => i.text === '|')?.color)
  await band.post({ pick: 'ultracode', target: 'main' }, { in: 'effort-row' })
  expect(draft).toBe('fix the tests')
  await band.unmount()
  expect(commands).toEqual([])
})

test('the session row is a three-column table with no separators', async ($, on) => {
  engine(on)
  await startSession($, on, { id: 'abc-123', sessionFile: { sessionId: 'abc-123', name: 'peer' } })
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('peer')
  await band.post({ press: true }, { in: 'session-chip' })
  const row = await band.find({ key: 'session-row' })
  const lines = (row?.props['props'] as { lines: { text: string; pad?: number }[][] } | undefined)?.lines ?? []
  expect(lines.flat().some(i => i.text === '|')).toBe(false)
  const thirdColumn = (line: { text: string; pad?: number }[]) =>
    line.slice(0, -1).reduce((col, item) => col + item.text.length + (item.pad ?? 0) + 2, 0)
  const withNote = lines.filter(l => l[0]?.text.trim() !== 'Agent')
  expect(withNote.map(l => l[l.length - 1]?.text)).toEqual([expect.stringMatching(/^started /), 'Claude Code 2.1.288'])
  expect(new Set(withNote.map(thirdColumn)).size).toBe(1)
  await band.unmount()
})

test('a row opened again after moving straight to another name goes back in at the bottom', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ hover: true }, { in: 'effort-chip' })
  await clock.advance(110)
  await band.post({ hover: false }, { in: 'effort-chip' })
  await band.post({ hover: true }, { in: 'model-chip' })
  await clock.advance(110)
  expect(await blockOrder(band)).toEqual(['model'])
  await band.post({ press: true }, { in: 'model-chip' })
  await band.post({ hover: false }, { in: 'model-chip' })
  await band.post({ hover: true }, { in: 'effort-chip' })
  await clock.advance(110)
  expect(await blockOrder(band)).toEqual(['model', 'effort'])
  await band.unmount()
})

test('a click in a row picks the choice under the pointer, and Left, Right and Enter pick from the keyboard', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ press: true }, { in: 'effort-chip' })
  await band.pointer({ type: 'up', x: TITLE_WIDTH + ROW_GAP, y: 0, button: 'left', in: 'effort-row' })
  expect(commands).toEqual(['effort low'])

  await band.post({ press: true }, { in: 'effort-chip' })
  await band.key({ key: 'right', in: 'effort-row' })
  await band.key({ key: 'return', in: 'effort-row' })
  expect(commands).toEqual(['effort low', 'effort high'])
  await band.unmount()
})

test('the name chip opens its row on pointer enter and pins it on click', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.pointer({ type: 'enter', x: 0, y: 0, in: 'model-chip' })
  await clock.advance(110)
  expect(await band.find({ key: 'model-row' })).toBeDefined()
  expect(await pinnedOf(band, 'model')).toBe(false)
  await band.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'model-chip' })
  expect(await pinnedOf(band, 'model')).toBe(true)
  await band.unmount()
})

test('a hovered row fades out by its own frames and then closes', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ hover: true }, { in: 'effort-chip' })
  await clock.advance(110)
  await band.advance(400)
  await band.post({ hover: false }, { in: 'effort-chip' })
  await band.advance(700)
  expect(await band.find({ key: 'effort-row' })).toBeUndefined()
  await band.unmount()
})

test('a pinned row stays open when the pointer leaves it', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ press: true }, { in: 'effort-chip' })
  await band.post({ hover: true }, { in: 'effort-row' })
  await band.post({ hover: false }, { in: 'effort-row' })
  await clock.advance(1100)
  expect((await band.find({ key: 'effort-row' }))?.props['props']).toMatchObject({ fade: false, closing: false })
  expect(await blockOrder(band)).toEqual(['effort'])
  await band.unmount()
})

test('off Windows the folder opens with open, then xdg-open, and a failure says so', async ($, on) => {
  engine(on)
  const runs: string[] = []
  let opens = true
  await startSession($, on, {
    env: { HOME: '/home/me' },
    run: argv => {
      if (argv[0] === 'open' || argv[0] === 'xdg-open') runs.push(argv.join(' '))
      return { exitCode: opens && argv[0] === 'xdg-open' ? 0 : 1 }
    },
  })
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ press: true }, { in: 'project-chip' })
  expect(runs).toEqual(['open C:/work/app', 'xdg-open C:/work/app'])
  expect(toasts.join('')).not.toContain('Could not open')
  opens = false
  await band.post({ press: true }, { in: 'project-chip' })
  expect(toasts.join('')).toContain('Could not open C:/work/app')
  await band.unmount()
})

test('the git rows hold the GitHub links as buttons, which open over https only', async ($, on) => {
  engine(on)
  const opened: unknown[] = []
  await startSession($, on, {
    env: { OS: 'Windows_NT' },
    run: (argv, env) => {
      if (argv[0] === 'powershell') {
        opened.push(env)
        return { exitCode: 0 }
      }
      if (argv.includes('status')) return { exitCode: 0, stdout: '# branch.oid abc\n# branch.head feat/x' }
      if (argv.includes('config')) return { exitCode: 0, stdout: 'git@github.com:acme/app.git' }
      if (argv.includes('for-each-ref')) return { exitCode: 0, stdout: 'refs/remotes/origin/main\t' }
      if (argv.includes('--verify')) return { exitCode: 0, stdout: 'abc' }
      if (argv.includes('rev-list')) return { exitCode: 0, stdout: '0\t3' }
      return { exitCode: argv[0] === 'git' ? 0 : 1 }
    },
  })
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await band.findAll({ type: 'Client' })).not.toContainEqual(expect.objectContaining({ props: expect.objectContaining({ key: expect.stringMatching(/link/) }) }))
  await band.post({ press: true }, { in: 'branch-chip' })
  await band.post({ press: true }, { in: 'base-chip' })
  const firstLine = async (key: string) =>
    ((await band.find({ key }))?.props['props'] as { lines: { text: string; pick?: string }[][] }).lines[0] ?? []
  const view = (await firstLine('branch-row')).find(i => i.pick)
  expect(view).toMatchObject({ text: 'View branch ↗', pick: 'https://github.com/acme/app/tree/feat%2Fx' })
  expect((await firstLine('base-row')).find(i => i.pick)).toMatchObject({
    text: 'Create PR ↗',
    pick: 'https://github.com/acme/app/compare/main...feat%2Fx?expand=1',
  })
  await band.post({ pick: 'http://example.com/x', target: 'main' }, { in: 'branch-row' })
  await band.post({ pick: 'file:///C:/Windows', target: 'main' }, { in: 'branch-row' })
  expect(opened).toEqual([])
  await band.post({ pick: view?.pick ?? '', target: 'main' }, { in: 'branch-row' })
  expect(opened).toEqual([{ THE_INDEX_OPEN: view?.pick }])
  expect(await pinnedOf(band, 'branch')).toBe(true)
  await band.unmount()
})

test('the lines above and below open rows follow the prompt border', async ($, on) => {
  engine(on)
  await startSession($, on)
  const plain = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await plain.post({ press: true }, { in: 'effort-chip' })
  expect((await plain.findAll({ type: 'Text', text: /^─+$/ })).map(r => r.props['color'])).toEqual(['promptBorder', 'promptBorder'])
  await plain.unmount()
})

test('the agent setting names the agent after the harness and its file colour tints the band', async ($, on) => {
  engine(on)
  extraSettings = { agent: 'reviewer' }
  await startSession($, on, { sessionFile: { sessionId: 'abc', name: 'peer' }, files: { 'reviewer.md': '---\nname: reviewer\ncolor: blue\n---\nReview.' } })
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('Claude reviewer Opus 5.5 high')
  expect((await band.find({ key: 'model-chip' }))?.props['props']).toMatchObject({ color: 'blue_FOR_SUBAGENTS_ONLY' })
  await band.post({ press: true }, { in: 'session-chip' })
  expect((await band.findAll({ type: 'Text', text: /^─+$/ }))[0]?.props['color']).toBe('blue_FOR_SUBAGENTS_ONLY')
  const rows = ((await band.find({ key: 'session-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  expect(rows.find(l => l[0]?.text.trim() === 'Agent')?.map(i => i.text.trim())).toEqual(['Agent', 'reviewer', 'colour blue'])
  await band.unmount()
})

test('a subagent transcript takes the colour its agent file gives its type', async ($, on) => {
  engine(on)
  await startSession($, on, { files: { 'explore.md': '---\nname: Explore\ncolor: green\n---\n' } })
  await step($, 'claude-sonnet-5-5', 'low', 'a1')
  const sub = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props('a1') })
  expect((await sub.find({ key: 'model-chip' }))?.props['props']).toMatchObject({ color: 'green_FOR_SUBAGENTS_ONLY' })
  await sub.unmount()
})

test('hovering the call telemetry bars cost per token by turn, and a bar shows its turn', async ($, on) => {
  engine(on)
  await step($, 'claude-opus-5-5', 'high')
  await step($, 'claude-opus-5-5', 'high')
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  const chip = await band.find({ key: 'calls-chip' })
  expect((chip?.props['props'] as { text: string }).text).toStartWith('Δ ↑10')
  expect((chip?.props['props'] as { parts?: unknown[] }).parts?.length).toBeGreaterThan(1)
  await band.post({ hover: true }, { in: 'calls-chip' })
  await clock.advance(110)
  const lines = ((await band.find({ key: 'calls-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  expect(lines).toHaveLength(8)
  expect(lines.at(-1)?.at(-1)?.text).toBe('hover a bar for its turn · last 1 of 1')
  await band.pointer({ type: 'move', x: TITLE_WIDTH + ROW_GAP, y: 0, in: 'calls-row' })
  expect(visible(await band.drawn({ in: 'calls-row' }))).toContain('turn 1 · 20k tokens')
  await band.post({ hover: false }, { in: 'calls-chip' })
  await band.post({ hover: true }, { in: 'totals-chip' })
  await clock.advance(110)
  const totals = ((await band.find({ key: 'totals-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  expect(totals.at(-1)?.at(-1)?.text).toBe('2 calls this session')
  await band.unmount()
})

test('each step adds to the shared usage file, and hovering the rate limits charts it with other sessions', async ($, on) => {
  engine(on)
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($, e) => {
    const w = e as { path: string; text: string }
    writes.push({ path: w.path.replace(/\\/g, '/'), text: w.text })
    return { value: undefined } as never
  })
  const today = new Date(START + 60_000)
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const other = JSON.stringify({ version: 1, days: { [day]: { other: { tokens: 1_000_000, costStart: 0, costEnd: 2 } } } })
  await startSession($, on, { files: { 'the-index-usage.json': other } })
  await step($, 'claude-opus-5-5', 'high')
  await step($, 'claude-sonnet-5-5', 'low', 'a1')
  await clock.advance(5100)
  const write = writes.filter(w => w.path.endsWith('/the-index-usage.json')).at(-1)
  expect(write?.path).toBe('C:/nobody/.claude/the-index-usage.json')
  const saved = JSON.parse(write?.text ?? '{}') as { days: Record<string, Record<string, { tokens: number }>> }
  expect(saved.days[day]?.['other']?.tokens).toBe(1_000_000)
  expect(saved.days[day]?.['abc']?.tokens).toBe(2 * 10_200)

  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ hover: true }, { in: 'usage-chip' })
  await clock.advance(110)
  const lines = ((await band.find({ key: 'usage-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  expect(lines.map(l => l.at(-1)?.text)).toContain('today 1.0M')
  expect(lines.at(-1)?.at(-1)?.text).toBe(`since ${day}`)
  await band.unmount()
})

test('hovering the context shows its fill over time, the compaction threshold and each compaction', async ($, on) => {
  engine(on)
  await startSession($, on)
  const measure = (percent: number) =>
    $.session.measure({ context: { window: 200_000, percent, tokens: percent * 2000 }, rateLimits: [] } as never)
  await measure(20)
  await measure(55)
  await measure(81)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
  await measure(9)
  await measure(30)
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('💥')
  expect(((await band.find({ key: 'context-chip' }))?.props['props'] as { text: string }).text).toMatch(/^☀ ░░m 💥/)
  await band.post({ hover: true }, { in: 'context-chip' })
  await clock.advance(110)
  const lines = ((await band.find({ key: 'context-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  const notes = lines.map(l => l.at(-1)?.text)
  expect(notes).toContain('100% · 200k window')
  expect(notes).toContain('compacts at 80%')
  expect(notes).toContain('now 30% · 60k')
  expect(notes).toContain('peak 81%')
  expect(notes.at(-1)).toBe('▲ 1 compaction')
  expect(lines.at(-1)?.map(i => i.text).join('')).toContain('▲')
  await band.unmount()
})

test('hovering the branch and base sections charts the working tree and the base branch commits', async ($, on) => {
  engine(on)
  const committed = Math.floor((START + 60_000 - 3_600_000) / 1000)
  await startSession($, on, {
    run: argv => {
      if (argv.includes('status')) return { exitCode: 0, stdout: '# branch.oid abc\n# branch.head feat/x\n1 .M N... 100644 100644 100644 a a a.ts' }
      if (argv.includes('diff') && argv.includes('HEAD')) return { exitCode: 0, stdout: '12\t3\ta.ts' }
      if (argv.includes('for-each-ref')) return { exitCode: 0, stdout: 'refs/remotes/origin/main\t' }
      if (argv.includes('-1')) return { exitCode: 0, stdout: `abc\t${committed}` }
      if (argv.includes('-10')) return { exitCode: 0, stdout: '@m2\t200\tSecond\n5\t1\tx.ts\n@m1\t100\tFirst\n2\t0\ty.ts' }
      return { exitCode: argv[0] === 'git' ? 0 : 1 }
    },
  })
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  await band.post({ hover: true }, { in: 'base-chip' })
  await clock.advance(110)
  const base = ((await band.find({ key: 'base-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  expect(base.at(-1)?.at(-1)?.text).toBe('last 2 commits to origin/main')
  await band.post({ hover: false }, { in: 'base-chip' })
  await band.post({ hover: true }, { in: 'branch-chip' })
  await clock.advance(110)
  const branch = ((await band.find({ key: 'branch-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  expect(branch.map(l => l.at(-1)?.text)).toContain('+12 lines')
  expect(branch.at(-1)?.at(-1)?.text).toBe('1h0m since the last commit')
  await band.unmount()
})
