import { expect, mock, test, type MockClock, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = 1_800_000_000_000
const REPO = 'C:/work/app'

type Repo = {
  branch: string
  numstat: string
  behindAhead: string
  pushed: boolean
  pr: { number: number; url: string } | null
}

type Harness = {
  clock: MockClock
  repo: Repo
  cwd: { value: string }
  mtimes: Map<string, number>
  runs: (readonly string[])[]
  gate: { hold: boolean; release: () => void; waiting: Promise<void> | null }
  touch: (path: string) => void
  maxStatusAtOnce: () => number
}

function harness(on: On): Harness {
  const repo: Repo = { branch: 'feat/x', numstat: '1\t0\ta.ts', behindAhead: '0\t1', pushed: true, pr: null }
  const cwd = { value: REPO }
  const mtimes = new Map<string, number>()
  const runs: (readonly string[])[] = []
  let releaseGate = () => {}
  const gate: Harness['gate'] = { hold: false, release: () => releaseGate(), waiting: null }
  let statusNow = 0
  let statusMax = 0
  const clock = mock.clock(on, { now: START })

  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 200_000 }, rateLimits: [] } as never }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.start', () => ({ cwd: REPO }))
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: cwd.value }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.version', () => ({ value: { version: '2.1.288' } }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  mock.env(on, { USERPROFILE: 'C:/nobody' })
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    throw new Error(`ENOENT ${String((e as { path?: string }).path)}`)
  })
  on('fs.stat', ($, e) => {
    const path = String((e as { path?: string }).path).replace(/\\/g, '/')
    const mtimeMs = mtimes.get(path)
    if (mtimeMs === undefined) throw new Error(`ENOENT ${path}`)
    return { value: { kind: 'file', size: 0, mtimeMs, isLink: false } } as never
  })
  on('process.run', async ($, e) => {
    const { argv } = e as { argv: readonly string[] }
    runs.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const dir = argv[2] ?? ''
    if (argv[0] === 'gh') {
      if (argv.includes('view')) return repo.pr ? ok(JSON.stringify({ ...repo.pr, state: 'OPEN' })) : fail
      return ok('[]')
    }
    if (argv.includes('--absolute-git-dir')) return ok(`${dir}/.git`)
    if (argv.includes('--git-common-dir')) return ok(`${dir}/.git`)
    if (argv.includes('status')) {
      statusNow += 1
      statusMax = Math.max(statusMax, statusNow)
      try {
        if (gate.hold) {
          gate.waiting = new Promise<void>(resolve => {
            releaseGate = resolve
          })
          await gate.waiting
        }
        return ok(`# branch.oid abc\n# branch.head ${dir === REPO ? repo.branch : 'other/y'}\n1 .M N... 100644 100644 100644 a a a.ts`)
      } finally {
        statusNow -= 1
      }
    }
    if (argv.includes('config')) return ok('git@github.com:acme/app.git')
    if (argv.includes('for-each-ref')) return ok('refs/remotes/origin/main\t')
    if (argv.includes('--verify')) return repo.pushed ? ok('abc') : fail
    if (argv.includes('rev-list')) return ok(repo.behindAhead)
    if (argv.includes('--numstat') && argv.includes('HEAD')) return ok(repo.numstat)
    return argv[0] === 'git' ? ok('') : fail
  })

  return {
    clock,
    repo,
    cwd,
    mtimes,
    runs,
    gate,
    touch: path => mtimes.set(path, (mtimes.get(path) ?? 0) + 1),
    maxStatusAtOnce: () => statusMax,
  }
}

const props = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 200,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

function visible(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(visible).join('')
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] } | null
  if (!n || typeof n !== 'object') return ''
  if (n.type === 'Client') return String((n.props?.['props'] as { text?: string } | undefined)?.text ?? '')
  return (n.children ?? []).map(visible).join('')
}

async function band($: Parameters<TestBody>[0]): Promise<string> {
  const mounted = await $.ui.mount({ plugin: 'the-index', surface: 'terminal', component: 'AbovePrompt', props })
  const text = visible(await mounted.drawn())
  await mounted.unmount()
  return text
}

async function start($: Parameters<TestBody>[0]): Promise<void> {
  await $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true } as never)
}

const statusRuns = (h: Harness) => h.runs.filter(argv => argv.includes('status')).length

test('a commit made outside the session shows within one poll', async ($, on) => {
  const h = harness(on)
  h.touch(`${REPO}/.git/logs/HEAD`)
  await start($)
  expect(await band($)).toContain('+1 -0')
  h.repo.numstat = '7\t2\ta.ts'
  h.repo.behindAhead = '0\t2'
  h.touch(`${REPO}/.git/logs/HEAD`)
  await h.clock.advance(11_000)
  expect(await band($)).toContain('+7 -2')
})

test('a push made outside the session is noticed through the remote branch ref', async ($, on) => {
  const h = harness(on)
  h.repo.pushed = false
  await start($)
  await h.clock.advance(11_000)
  const before = statusRuns(h)
  h.repo.pushed = true
  h.touch(`${REPO}/.git/refs/remotes/origin/feat/x`)
  await h.clock.advance(11_000)
  expect(statusRuns(h)).toBeGreaterThan(before)
})

test('a change that lands while a refresh is running is read by the next poll', async ($, on) => {
  const h = harness(on)
  await start($)
  h.gate.hold = true
  h.touch(`${REPO}/.git/index`)
  await h.clock.advance(11_000)
  expect(h.gate.waiting).not.toBeNull()
  h.repo.numstat = '9\t9\ta.ts'
  h.touch(`${REPO}/.git/index`)
  h.gate.hold = false
  h.gate.release()
  await h.clock.advance(11_000)
  expect(await band($)).toContain('+9 -9')
})

test('refreshes asked for during a run wait for it and then run once', async ($, on) => {
  const h = harness(on)
  await start($)
  h.gate.hold = true
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await h.clock.advance(1100)
  const during = statusRuns(h)
  h.gate.hold = false
  for (let i = 0; i < 5; i++) {
    await $.tool.call({ tool: 'Bash', command: `echo ${i}` } as never)
    await h.clock.advance(1100)
  }
  h.gate.release()
  await h.clock.advance(100)
  expect(h.maxStatusAtOnce()).toBe(1)
  expect(statusRuns(h)).toBe(during + 1)
})

test('a PR opened right after a push shows once the gh command runs', async ($, on) => {
  const h = harness(on)
  await start($)
  expect(await band($)).not.toContain('#42')
  h.repo.pr = { number: 42, url: 'https://github.com/acme/app/pull/42' }
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' } as never)
  await h.clock.advance(1100)
  expect(await band($)).toContain('#42 origin/main')
})

test('the PR number stays on the band while a refresh looks it up again', async ($, on) => {
  const h = harness(on)
  h.repo.pr = { number: 42, url: 'https://github.com/acme/app/pull/42' }
  await start($)
  expect(await band($)).toContain('#42')
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  h.gate.hold = true
  await h.clock.advance(1100)
  expect(await band($)).toContain('#42')
  h.gate.hold = false
  h.gate.release()
  await h.clock.advance(100)
})

test('an edit made outside the session, which touches nothing in .git, shows within a minute', async ($, on) => {
  const h = harness(on)
  await start($)
  h.repo.numstat = '3\t1\ta.ts'
  await h.clock.advance(61_000)
  expect(await band($)).toContain('+3 -1')
})

test('after the session moves to another worktree, the poll watches that worktree', async ($, on) => {
  const h = harness(on)
  await start($)
  h.cwd.value = 'C:/work/app-y'
  await h.clock.advance(11_000)
  expect(await band($)).toContain('other/y')
  const before = statusRuns(h)
  h.touch('C:/work/app-y/.git/HEAD')
  await h.clock.advance(11_000)
  expect(statusRuns(h)).toBeGreaterThan(before)
})

test('a poll that finds nothing changed runs no git', async ($, on) => {
  const h = harness(on)
  await start($)
  await h.clock.advance(1100)
  const before = statusRuns(h)
  await h.clock.advance(30_000)
  expect(statusRuns(h)).toBe(before)
})
