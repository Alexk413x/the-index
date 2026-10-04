import { expect, mock, test, type MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const START = 1_800_000_000_000

const seenEfforts: (string | number | undefined)[] = []
const seenModels: string[] = []
const commands: string[] = []
let stepsFail = false
let sessionModel = 'claude-opus-5-5'
let clock: MockClock

function engine(on: On) {
  seenEfforts.length = 0
  seenModels.length = 0
  commands.length = 0
  stepsFail = false
  sessionModel = 'claude-opus-5-5'
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
    value: { modelSettings: { 'claude-fable-5-1': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { effortLevel: 'xhigh' } } },
  }))
  on('ui.toast', () => ({ value: undefined }))
  clock = mock.clock(on, { now: START + 60_000 })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000, percent: 12, tokens: 24_000 }, rateLimits: [], cost: { usd: 0.25 } },
  }))
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
  on('session.cwd', () => ({ value: 'C:/work/app' }))
  const envs: unknown[] = []
  on('process.run', ($, e) => {
    runs.push((e as { argv: readonly string[] }).argv)
    envs.push((e as { init?: { env?: unknown } }).init?.env)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.env(on, { OS: 'Windows_NT' })
  on('session.start', () => ({ cwd: 'C:/work/app' }))
  on('command.register', () => ({ value: {} }) as never)
  on('session.id', () => ({ value: 'abc' }))
  on('session.version', () => ({ value: { version: '2.1.288' } }) as never)
  await $.session.start({ cwd: 'C:/work/app', surface: 'terminal', isInteractive: true } as never).catch(() => undefined)
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
  const order = async () => {
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
  await band.post({ press: true }, { in: 'effort-chip' })
  await band.post({ press: true }, { in: 'model-chip' })
  expect(await order()).toEqual(['effort', 'model'])
  expect((await band.find({ key: 'model-chip' }))?.props['props']).toMatchObject({ isActive: true })

  await band.post({ hover: true }, { in: 'effort-pin' })
  await band.post({ press: true }, { in: 'effort-pin' })
  expect(await order()).toEqual(['effort', 'model'])
  expect(await pinnedOf(band, 'effort')).toBe(false)

  await band.post({ hover: false }, { in: 'effort-pin' })
  await clock.advance(1010)
  expect(await order()).toEqual(['model'])

  await band.post({ press: true }, { in: 'effort-chip' })
  expect(await order()).toEqual(['model', 'effort'])
  await band.post({ press: true }, { in: 'model-pin' })
  expect(await order()).toEqual(['effort'])
  await band.unmount()
})

test('the effort shows before the first request, from the saved setting for the model', async ($, on) => {
  engine(on)
  sessionModel = 'claude-sonnet-5-5'
  on('session.start', () => ({ cwd: '.' }))
  mock.env(on, { USERPROFILE: 'C:/nobody' })
  on('fs.list', () => ({ value: [] }))
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '.' }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.version', () => ({ value: { version: '2.1.288' } }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true } as never)
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
  on('session.start', () => ({ cwd: 'C:/work/app' }))
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: 'C:/work/app' }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.version', () => ({ value: { version: '2.1.288' } }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  mock.env(on, { USERPROFILE: 'C:/nobody' })
  on('fs.list', () => ({ value: [] }))
  await $.session.start({ cwd: 'C:/work/app', surface: 'terminal', isInteractive: true } as never)
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
  on('session.start', () => ({ cwd: 'C:/work/app' }))
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: 'C:/work/app' }))
  on('session.id', () => ({ value: 'abc-123' }))
  on('session.version', () => ({ value: { version: '2.1.288' } }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  mock.env(on, { USERPROFILE: 'C:/nobody' })
  on('fs.list', ($, e) =>
    /sessions$/.test(String((e as { path?: string }).path))
      ? ({ value: [{ name: '1.json', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] } as never)
      : { value: [] },
  )
  on('fs.read', () => ({ value: JSON.stringify({ sessionId: 'abc-123', name: 'peer' }) }))
  await $.session.start({ cwd: 'C:/work/app', surface: 'terminal', isInteractive: true } as never)
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props: props() })
  expect(await bandText(band)).toContain('peer')
  await band.post({ press: true }, { in: 'session-chip' })
  const row = await band.find({ key: 'session-row' })
  const lines = (row?.props['props'] as { lines: { text: string; pad?: number }[][] } | undefined)?.lines ?? []
  expect(lines.flat().some(i => i.text === '|')).toBe(false)
  const thirdColumn = (line: { text: string; pad?: number }[]) =>
    line.slice(0, -1).reduce((col, item) => col + item.text.length + (item.pad ?? 0) + 2, 0)
  expect(lines.map(l => l[l.length - 1]?.text)).toEqual([expect.stringMatching(/^started /), 'Claude Code 2.1.288'])
  expect(new Set(lines.map(thirdColumn)).size).toBe(1)
  await band.unmount()
})
