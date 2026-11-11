import { expect, mock, test, type MockClock, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { monthKey, monthsBack } from '../hooks/lib/share'

const START = 1_800_000_000_000
const REPO = 'C:/work/app'
const SHARE = `C:/nobody/.claude/the-index/usage/${monthKey(START)}`
const TRANSCRIPT = 'C:/nobody/.claude/projects/C--work-app/abc.jsonl'

type Calls = { usage: number; breakdown: number; reads: Map<string, number>; writes: Map<string, number>; runs: { argv: readonly string[]; env?: Record<string, string> }[] }

type Harness = { clock: MockClock; calls: Calls; files: Map<string, string>; sizes: Map<string, number> }

function harness(on: On): Harness {
  const calls: Calls = { usage: 0, breakdown: 0, reads: new Map(), writes: new Map(), runs: [] }
  const files = new Map<string, string>()
  const sizes = new Map<string, number>()
  const clock = mock.clock(on, { now: START })
  const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  const slash = (e: unknown) => String((e as { path?: string }).path).replace(/\\/g, '/')

  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.usage', ($, e) => {
    const wantsBreakdown = Boolean((e as { breakdown?: string }).breakdown)
    calls.usage += 1
    if (wantsBreakdown) calls.breakdown += 1
    return {
      value: {
        startedAt: START,
        context: {
          window: 200_000,
          percent: 12,
          tokens: 24_000,
          ...(wantsBreakdown
            ? { breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: 160_000, totalTokens: 24_000, maxTokens: 200_000, categories: [{ name: 'Messages', tokens: 20_000, isDeferred: false, kind: 'used' }], memoryFiles: [], mcpTools: [], agents: [] } }
            : {}),
        },
        rateLimits: [],
        cost: { usd: 0.25 },
      } as never,
    }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.start', () => ({ cwd: REPO }))
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: REPO }))
  on('session.root', () => ({ value: REPO }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.version', () => ({ value: { version: '2.1.288' } }) as never)
  on('session.measure', () => ({ changed: [] }))
  on('classic.UserPromptSubmit', () => ({}))
  on('process.run', ($, e) => {
    const { argv, init } = e as { argv: readonly string[]; init?: { env?: Record<string, string> } }
    calls.runs.push({ argv, ...(init?.env ? { env: init.env } : {}) })
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: e.model, input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 9000, cache_creation_input_tokens: 990 },
    }
  })
  mock.env(on, { USERPROFILE: 'C:/nobody' })
  const entry = (name: string) => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })
  on('fs.list', ($, e) => {
    const dir = slash(e)
    const names = [...files.keys()].filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map(p => p.slice(dir.length + 1))
    const folders = [...new Set([...files.keys()].filter(p => p.startsWith(`${dir}/`) && p.slice(dir.length + 1).includes('/')).map(p => p.slice(dir.length + 1).split('/')[0] ?? ''))]
    return {
      value: [...names.map(name => ({ ...entry(name), size: files.get(`${dir}/${name}`)?.length ?? 0 })), ...folders.map(name => ({ ...entry(name), kind: 'dir' }))],
    } as never
  })
  on('fs.stat', ($, e) => {
    const path = slash(e)
    const text = files.get(path)
    if (text === undefined) throw new Error(`ENOENT ${path}`)
    return { value: { kind: 'file', size: sizes.get(path) ?? text.length, mtimeMs: 1, isLink: false } } as never
  })
  on('fs.read', ($, e) => {
    const path = slash(e)
    count(calls.reads, path)
    const text = files.get(path)
    if (text === undefined) throw new Error(`ENOENT ${path}`)
    if ((sizes.get(path) ?? 0) > 4 * 1024 * 1024) throw new Error('over 4 MiB')
    return { value: text }
  })
  on('fs.write', ($, e) => {
    const w = e as { path: string; text: string }
    const path = w.path.replace(/\\/g, '/')
    count(calls.writes, path)
    files.set(path, w.text)
    return { value: undefined } as never
  })
  return { clock, calls, files, sizes }
}

const props = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} }

async function start($: Parameters<TestBody>[0]): Promise<void> {
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true } as never)
}

async function step($: Parameters<TestBody>[0], turnId = 't') {
  const e = { turnId, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }
  for await (const _ of $.turn.step(e as never)) void _
}

async function sessionRow($: Parameters<TestBody>[0]): Promise<string[]> {
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props })
  await band.post({ press: true }, { in: 'session-chip' })
  const lines = ((await band.find({ key: 'session-row' }))?.props['props'] as { lines: { text: string }[][] } | undefined)?.lines ?? []
  await band.unmount()
  return lines.flat().map(i => i.text.trim())
}

test('a main step asks the session for its usage twice: before the call and after it', async ($, on) => {
  const h = harness(on)
  await start($)
  const before = h.calls.usage
  await step($)
  expect(h.calls.usage - before).toBe(2)
})

test('a new context reading asks for the usage once, with the breakdown its categories need', async ($, on) => {
  const h = harness(on)
  await start($)
  const measure = (percent: number) => $.session.measure({ context: { window: 200_000, percent, tokens: percent * 2000 }, rateLimits: [] } as never)
  await measure(20)
  const usage = h.calls.usage
  const breakdown = h.calls.breakdown
  await measure(30)
  expect(h.calls.usage - usage).toBe(1)
  expect(h.calls.breakdown - breakdown).toBe(1)
  await measure(30)
  expect(h.calls.usage - usage).toBe(2)
  expect(h.calls.breakdown - breakdown).toBe(1)
})

test('a transcript over 4 MiB keeps the title the last prompt carried', async ($, on) => {
  const h = harness(on)
  h.files.set('C:/nobody/.claude/sessions/1.json', JSON.stringify({ sessionId: 'abc', name: 'peer' }))
  h.files.set(TRANSCRIPT, '{"type":"ai-title","aiTitle":"Old"}\n')
  h.sizes.set(TRANSCRIPT, 5 * 1024 * 1024)
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Fix the band' } as never)
  expect(await sessionRow($)).toContain('Fix the band')
  expect(h.calls.reads.get(TRANSCRIPT) ?? 0).toBe(0)
})

test('the transcript is read again only when it changed', async ($, on) => {
  const h = harness(on)
  h.files.set('C:/nobody/.claude/sessions/1.json', JSON.stringify({ sessionId: 'abc', name: 'peer' }))
  h.files.set(TRANSCRIPT, '{"type":"ai-title","aiTitle":"Small"}\n')
  await start($)
  await sessionRow($)
  await sessionRow($)
  expect(h.calls.reads.get(TRANSCRIPT)).toBe(1)
})

test("once found, the session's own file is the only session file read", async ($, on) => {
  const h = harness(on)
  h.files.set('C:/nobody/.claude/sessions/1.json', JSON.stringify({ sessionId: 'other', name: 'x' }))
  h.files.set('C:/nobody/.claude/sessions/2.json', JSON.stringify({ sessionId: 'abc', name: 'peer' }))
  h.files.set('C:/nobody/.claude/sessions/3.json', JSON.stringify({ sessionId: 'third', name: 'y' }))
  await start($)
  await h.clock.advance(3 * 61_000)
  expect(h.calls.reads.get('C:/nobody/.claude/sessions/1.json')).toBe(1)
  expect(h.calls.reads.get('C:/nobody/.claude/sessions/3.json') ?? 0).toBeLessThanOrEqual(1)
  expect(h.calls.reads.get('C:/nobody/.claude/sessions/2.json')).toBeGreaterThan(1)
})

test('the shared usage file is written when a step adds to it, not on a sync with nothing new', async ($, on) => {
  const h = harness(on)
  await start($)
  await step($)
  await h.clock.advance(5100)
  const path = `${SHARE}/abc.json`
  expect(h.calls.writes.get(path)).toBe(1)
  await h.clock.advance(300_000)
  expect(h.calls.writes.get(path)).toBe(1)
})

test('another session file is read once, and again only after it changes', async ($, on) => {
  const h = harness(on)
  const otherPath = `${SHARE}/other.json`
  const turn = (id: string) => ({ id, session: 'other', at: START - 1000, tokens: 100, input: 90, cacheRead: 80, output: 10, apiMs: 1000, spanMs: 2000, linesAdded: 0, linesRemoved: 0, files: 0, costUsd: 0.1, calls: 1 })
  const file = (count: number) => JSON.stringify({ version: 1, session: 'other', name: 'peer', days: {}, turns: Array.from({ length: count }, (_, i) => turn(`o${i}`)) })
  h.files.set(otherPath, file(50))
  await start($)
  await h.clock.advance(1)
  expect(h.calls.reads.get(otherPath)).toBe(1)
  await step($)
  await h.clock.advance(5100)
  await h.clock.advance(300_000)
  expect(h.calls.reads.get(otherPath)).toBe(1)
  expect(h.calls.writes.get(otherPath)).toBeUndefined()
  const band = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props })
  await band.post({ hover: true }, { in: 'calls-chip' })
  await h.clock.advance(310)
  const lines = ((await band.find({ key: 'calls-row' }))?.props['props'] as { lines: { text: string }[][] }).lines
  expect(lines.at(-1)?.at(-1)?.text).toBe('7-day avg covers 50 turns in 1 session')
  await band.unmount()
  h.files.set(otherPath, file(51))
  await h.clock.advance(300_000)
  expect(h.calls.reads.get(otherPath)).toBe(2)
})

test('a resumed session adds to the file it left', async ($, on) => {
  const h = harness(on)
  const today = new Date(START)
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const path = `${SHARE}/abc.json`
  h.files.set(path, JSON.stringify({ version: 1, session: 'abc', name: 'app', days: { [day]: { tokens: 5000, costStart: 0, costEnd: 0.25, agents: { main: 5000 } } }, turns: [] }))
  await start($)
  await h.clock.advance(1)
  await step($)
  await h.clock.advance(5100)
  const saved = JSON.parse(h.files.get(path) ?? '{}') as { days: Record<string, { tokens: number; agents: Record<string, number> }> }
  expect(saved.days[day]?.tokens).toBe(5000 + 10_200)
  expect(saved.days[day]?.agents['main']).toBe(5000 + 10_200)
})

test('a passed month keeps its day totals, and its folder goes after three more months', async ($, on) => {
  const h = harness(on)
  const root = 'C:/nobody/.claude/the-index/usage'
  const file = (date: string) => JSON.stringify({ version: 1, session: 'old', name: 'old', days: { [date]: { tokens: 700, costStart: 0, costEnd: 1 } }, turns: [] })
  const kept = monthsBack(monthKey(START), 2)
  const gone = monthsBack(monthKey(START), 4)
  h.files.set(`${root}/${kept}/old.json`, file(`${kept}-10`))
  h.files.set(`${root}/${gone}/old.json`, file(`${gone}-10`))
  await start($)
  await h.clock.advance(1)
  expect(JSON.parse(h.files.get(`${root}/totals/${kept}.json`) ?? '{}')).toEqual({ version: 1, days: [{ date: `${kept}-10`, tokens: 700, costUsd: 1 }] })
  expect(JSON.parse(h.files.get(`${root}/totals/${gone}.json`) ?? '{}')).toEqual({ version: 1, days: [{ date: `${gone}-10`, tokens: 700, costUsd: 1 }] })
  const removals = h.calls.runs.filter(r => [...r.argv, ...Object.values(r.env ?? {})].some(text => text.replace(/\\/g, '/').endsWith(`/the-index/usage/${gone}`)))
  expect(removals).toHaveLength(1)
  expect(h.calls.runs.some(r => [...r.argv, ...Object.values(r.env ?? {})].some(text => text.replace(/\\/g, '/').endsWith(`/the-index/usage/${kept}`)))).toBe(false)
  await h.clock.advance(300_000)
  expect(h.calls.runs.filter(r => r === removals[0] || [...r.argv, ...Object.values(r.env ?? {})].some(text => text.replace(/\\/g, '/').endsWith(`/the-index/usage/${gone}`)))).toHaveLength(1)
})
