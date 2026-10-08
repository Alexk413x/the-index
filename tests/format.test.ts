import { describe, expect, test } from 'claude-code/testing'

import {
  EMPTY_TOTALS,
  MAIN,
  buildLines,
  fiveHourGlyph,
  cacheGlyph,
  contextGlyph,
  nextChangeMs,
  dimHex,
  fmtCost,
  fmtDur,
  fmtMs,
  fmtNum,
  fmtUntil,
  createdLines,
  gitLinks,
  lineText,
  mergeRateLimit,
  modelLabel,
  patchLineCounts,
  readConfig,
  repoWebFromRemote,
  type Snapshot,
} from '../hooks/format'
import {
  applyBase,
  applyPr,
  applyStatus,
  emptyGit,
  parsePullRequests,
  parseSharedLimits,
  parseWorktrees,
  samePath,
  serializeSharedLimits,
  worktreeGitDir,
  worktreeName,
} from '../hooks/git'

const NOW = 1_800_000_000_000

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW,
    agents: {},
    turn: null,
    totals: EMPTY_TOTALS,
    usage: null,
    git: null,
    host: null,
    clients: 0,
    agentEfforts: {},
    agentModels: {},
    ...over,
  }
}

describe('formatters match statusline.py', () => {
  test('numbers, money and durations', () => {
    expect(fmtNum(999)).toBe('999')
    expect(fmtNum(1234)).toBe('1.2k')
    expect(fmtNum(12_345)).toBe('12k')
    expect(fmtNum(2_500_000)).toBe('2.5M')
    expect(fmtCost(1.456)).toBe('1.46')
    expect(fmtCost(0.0034)).toBe('0.0034')
    expect(fmtCost(0)).toBe('0.00')
    expect(fmtDur(59)).toBe('59s')
    expect(fmtDur(61)).toBe('1m1s')
    expect(fmtDur(3700)).toBe('1h1m')
    expect(fmtDur(90_000)).toBe('1d1h')
    expect(fmtMs(250)).toBe('250ms')
    expect(fmtMs(2500)).toBe('2.5s')
    expect(fmtMs(75_000)).toBe('1m15s')
    expect(fmtUntil(NOW + 2 * 3600_000 + 5 * 60_000, NOW)).toBe('2h5m')
    expect(fmtUntil(NOW - 1, NOW)).toBe('0m')
  })

  test('model ids read as display names', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 (1M context)')
    expect(modelLabel('some-gateway-model')).toBe('some-gateway-model')
  })

  test('remotes become web URLs', () => {
    expect(repoWebFromRemote('git@github.com:acme/app.git')).toBe('https://github.com/acme/app')
    expect(repoWebFromRemote('ssh://git@github.com/acme/app')).toBe('https://github.com/acme/app')
    expect(repoWebFromRemote('http://example.com/acme/app.git')).toBe('https://example.com/acme/app')
    expect(repoWebFromRemote('/srv/repo')).toBe('')
  })

  test('a created file counts each of its lines', () => {
    expect(createdLines('a\nb\nc\n')).toBe(3)
    expect(createdLines('a\nb')).toBe(2)
    expect(createdLines('')).toBe(0)
  })

  test('patch hunks count added and removed lines', () => {
    expect(patchLineCounts([{ lines: [' a', '-b', '+c', '+d'] }, { lines: ['-e'] }])).toEqual({ added: 2, removed: 2 })
  })
})

describe('config', () => {
  test('defaults draw every segment at the script dim level', () => {
    const cfg = readConfig({})
    expect(cfg.dim).toBe(0.95)
    expect(cfg.show.rate_limits).toBe(true)
    expect(cfg.colors.high).toBe(dimHex('#d75f00', 0.95))
    expect(cfg.cacheTtlMs).toBe(3_600_000)
  })

  test('toggles, colours and dim apply', () => {
    const cfg = readConfig({ dim: 0.5, show_calls: false, color_model: '#ffffff', color_bad: 'nonsense', cache_ttl: '5m' })
    expect(cfg.show.calls).toBe(false)
    expect(cfg.colors.model).toBe('#808080')
    expect(cfg.colors.bad).toBe(dimHex('#c80000', 0.5))
    expect(cfg.cacheTtlMs).toBe(300_000)
  })
})

describe('band lines', () => {
  test('before the first call every value is a placeholder', () => {
    const lines = buildLines(snapshot(), readConfig({}))
    expect(lines).toHaveLength(2)
    expect(lineText(lines[0] ?? [])).toBe('Unknown ░░ | ☀ ░░m ○ ░░% ◷ ░░% ░h░░m ⧈ ░░% ░d░░h')
    expect(lineText(lines[1] ?? [])).toBe(
      'Δ »░ ↑░░ ⤒░░░░ ⤓░░░░ ↓░░░░ ↯░░ ⌖░░% ≡+░░ -░░ ⏱ ░░s $░.░░ | Σ ◦░ »░ ↑░░░ ⤒░░░░░ ⤓░░░░░ ↓░░░░ ↯░░ ⌖░░% ░░% ≡+░░░ -░░░ ⏱ ░░m░░s $░.░░',
    )
  })

  test('the main view reads the main loop, a subagent view reads that agent', () => {
    const snap = snapshot({
      agents: {
        [MAIN]: { model: 'claude-opus-5-5', effort: 'high' },
        a1: { model: 'claude-sonnet-5-5', effort: 'low' },
      },
      host: { sessionName: 'peer', bridged: false, ide: 'VS Code', agent: '', project: 'app' },
    })
    const cfg = readConfig({})
    expect(lineText(buildLines(snap, cfg)[0] ?? [])).toStartWith('peer | Claude Opus 5.5 high | VS Code | ')
    const sub = buildLines(snap, cfg, { id: 'a1', type: 'Explore', status: 'running', label: 'scan' })
    expect(lineText(sub[0] ?? [])).toStartWith('peer | ⤷ Explore scan Sonnet 5.5 low running | VS Code | ')
    const off = buildLines(snap, readConfig({ show_agent_view: false }), {
      id: 'a1',
      type: 'Explore',
      status: 'running',
      label: '',
    })
    expect(lineText(off[0] ?? [])).toStartWith('peer | Claude Opus 5.5 high')
  })

  test('telemetry, gauges and git render like the script', () => {
    const snap = snapshot({
      turn: {
        turnId: 't',
        calls: 3,
        input: 12,
        cacheWrite: 1500,
        cacheRead: 48_000,
        output: 800,
        apiMs: 4000,
        costStartUsd: 1,
        costUsd: 0.12,
        linesAdded: 3,
        linesRemoved: 1,
        files: ['a.ts'],
        start: 0,
        end: 4000,
      },
      totals: {
        ...EMPTY_TOTALS,
        requests: 5,
        turns: 2,
        input: 100,
        output: 3000,
        tpsSum: 300,
        tpsCalls: 4,
        cacheWrite: 20_000,
        cacheRead: 80_000,
        apiMs: 65_000,
        ewmaHit: 0.9,
        linesAdded: 40,
        linesRemoved: 7,
        lastResponseAt: NOW - 10 * 60_000,
      },
      usage: {
        startedAt: NOW - 3_725_000,
        contextPercent: 45,
        contextTokens: 90_000,
        costUsd: 1.5,
        fiveHour: { usedPercentage: 23.5, resetsAt: NOW + 2 * 3600_000 },
        sevenDay: { usedPercentage: 61, resetsAt: NOW - 1 },
        compactions: 2,
      },
      git: {
        ...emptyGit('git@github.com:acme/app.git'),
        branch: 'feat/x',
        branchPushed: true,
        filesAdded: 1,
        filesModified: 2,
        linesAdded: 10,
        linesRemoved: 4,
        prBaseRef: 'origin/main',
        prBaseName: 'main',
        prAhead: 3,
        prFilesModified: 4,
        prLinesAdded: 50,
        prLinesRemoved: 9,
      },
      host: { sessionName: '', bridged: false, ide: '', agent: '', project: 'app' },
      agents: { [MAIN]: { model: 'claude-opus-5-5' } },
    })
    const lines = buildLines(snap, readConfig({}))
    expect(lineText(lines[0] ?? [])).toBe(
      'Claude Opus 5.5 ░░ | ☀ 50m 💥💥 ◑ 45% 1h2m ◵ 23% 2h0m ⧈ ░░% ░d░░h',
    )
    expect(lineText(lines[1] ?? [])).toBe(
      'Δ »3 ↑50k ⤒1.5k ⤓48k ↓800 ↯200 ⌖96% ≡+3 -1 ⏱ 4.0s $0.12 | Σ ◦2 »5 ↑100k ⤒20k ⤓80k ↓3.0k ↯75 ⌖79% 90% ≡+40 -7 ⏱ 1m5s $1.50',
    )
    expect(lineText(lines[2] ?? [])).toBe('□ app | ⎇ feat/x ◻ 1 2 0 ≡ +10 -4 | ↑3 ↓0 ⎇ origin/main ◻ 0 4 0 ≡ +50 -9')
    expect(gitLinks(snap.git)).toEqual({
      repo: 'https://github.com/acme/app/tree/main',
      pulls: 'https://github.com/acme/app/pulls',
      branch: 'https://github.com/acme/app/tree/feat%2Fx',
      base: { label: 'Create PR', url: 'https://github.com/acme/app/compare/main...feat%2Fx?expand=1' },
    })
  })

  test('totals kept from a build without an output count show placeholders, not NaN', () => {
    const totals = { ...EMPTY_TOTALS, requests: 2, input: 10, cacheRead: 90, apiMs: 2000 }
    delete (totals as { output?: number }).output
    const line = lineText(buildLines(snapshot({ totals }), readConfig({}))[1] ?? [])
    expect(line).toContain('↓░░░░ ↯░░')
    expect(line).not.toContain('NaN')
  })

  test('toggled-off segments leave the band', () => {
    const cfg = readConfig({
      show_model: false,
      show_cache: false,
      show_context: false,
      show_uptime: false,
      show_rate_limits: false,
      show_calls: false,
      show_totals: false,
    })
    expect(buildLines(snapshot(), cfg)).toHaveLength(0)
  })
})

describe('git links', () => {
  const base = {
    ...emptyGit('git@github.com:acme/app.git'),
    branch: 'feat/x',
    prBaseRef: 'origin/main',
    prBaseName: 'main',
  }
  const host = { sessionName: '', bridged: false, ide: '', agent: '', project: 'app' }

  test('an unpushed branch has only the repo and PR list links', () => {
    expect(gitLinks({ ...base, branchPushed: false })).toEqual({
      repo: 'https://github.com/acme/app/tree/main',
      pulls: 'https://github.com/acme/app/pulls',
    })
  })

  test('on the base branch, the base link views its commit history', () => {
    expect(gitLinks({ ...base, branch: 'main', branchPushed: true })).toEqual({
      repo: 'https://github.com/acme/app/tree/main',
      pulls: 'https://github.com/acme/app/pulls',
      branch: 'https://github.com/acme/app/tree/main',
      base: { label: 'View Commits', url: 'https://github.com/acme/app/commits/main' },
    })
  })

  test('an open PR shows its number before the base name, and the base link views it', () => {
    const git = { ...base, branchPushed: true, prNumber: 42, prLink: 'https://github.com/acme/app/pull/42' }
    const lines = buildLines(snapshot({ git, host }), readConfig({}))
    expect(lines[2]?.[2]?.some(s => s.text === '#42 origin/main')).toBe(true)
    expect(gitLinks(git).base).toEqual({ label: 'View PR #42', url: 'https://github.com/acme/app/pull/42' })
  })

  test('a remote that is not a web host has no links', () => {
    expect(gitLinks({ ...emptyGit(''), branch: 'feat/x', branchPushed: true })).toEqual({})
  })
})

describe('pull requests', () => {
  test('gh pr list JSON reads as pull requests, skipping malformed entries', () => {
    expect(
      parsePullRequests([
        { number: 7, title: 'Fix', url: 'https://github.com/a/b/pull/7', headRefName: 'fix/x' },
        { number: 'x', url: 'u' },
        'nope',
      ]),
    ).toEqual([{ number: 7, title: 'Fix', url: 'https://github.com/a/b/pull/7', branch: 'fix/x' }])
    expect(parsePullRequests(undefined)).toEqual([])
  })
})

describe('git parsing', () => {
  test('status, base and PR diff fold into a snapshot', () => {
    const snap = emptyGit('')
    applyStatus(
      snap,
      ['# branch.oid abc', '# branch.head feat', '1 .M N... a', '1 A. N... b', '1 D. N... c', '? d'].join('\n'),
    )
    expect(snap).toMatchObject({ branch: 'feat', filesAdded: 2, filesModified: 1, filesDeleted: 1 })
    applyBase(snap, 'refs/remotes/origin/HEAD\trefs/remotes/origin/main\nrefs/remotes/origin/main\t')
    expect(snap.prBaseRef).toBe('origin/main')
    applyPr(snap, ':100644 100644 a b M\tx\n:000000 100644 0 c A\ty\n5\t2\tx\n1\t0\ty', '1\t4')
    expect(snap).toMatchObject({ prFilesModified: 1, prFilesAdded: 1, prLinesAdded: 6, prLinesRemoved: 2, prBehind: 1, prAhead: 4 })
  })

  test('local base on the base branch has no PR section', () => {
    const snap = emptyGit('')
    snap.branch = 'main'
    applyBase(snap, 'refs/heads/main\t')
    expect(snap.prBaseRef).toBe('')
  })
})

describe('shared rate limits', () => {
  test('the newest window wins, then the higher reading', () => {
    const a = { usedPercentage: 30, resetsAt: NOW }
    const b = { usedPercentage: 10, resetsAt: NOW + 3600_000 }
    expect(mergeRateLimit([a, b])).toEqual(b)
    expect(mergeRateLimit([a, { usedPercentage: 35, resetsAt: NOW + 60_000 }])?.usedPercentage).toBe(35)
    expect(mergeRateLimit([null, undefined])).toBeNull()
  })

  test('the file keeps statusline.py seconds-based shape', () => {
    const text = serializeSharedLimits({ fiveHour: { usedPercentage: 12, resetsAt: 1_700_000_000_000 }, sevenDay: null })
    expect(JSON.parse(text)).toEqual({ five_hour: { used_percentage: 12, resets_at: 1_700_000_000 } })
    expect(parseSharedLimits(JSON.parse(text)).fiveHour).toEqual({ usedPercentage: 12, resetsAt: 1_700_000_000_000 })
  })
})

describe('glyphs', () => {
  test('the context circle fills in five unicode steps or nine nerd-font slices', () => {
    expect([0, 10, 40, 60, 90].map(p => contextGlyph(p, 'unicode')).join('')).toBe('○◔◑◕●')
    expect(contextGlyph(0, 'nerd').codePointAt(0)).toBe(0xf0766)
    expect(contextGlyph(13, 'nerd').codePointAt(0)).toBe(0xf0a9e)
    expect(contextGlyph(100, 'nerd').codePointAt(0)).toBe(0xf0aa5)
  })

  test('the cache glyph cools from sun to snowflake', () => {
    expect([0.9, 0.4, 0.2, 0.05, 0].map(cacheGlyph).join('')).toBe('☀☼☼❅❄')
  })

  test('a linked Remote Control session leads the session name', () => {
    const host = { sessionName: 'peer', bridged: true, ide: '', agent: '', project: '' }
    const idle = buildLines(snapshot({ host }), readConfig({}))
    expect(lineText(idle[0] ?? [])).toStartWith('○ peer | ')
    const watched = buildLines(snapshot({ host, clients: 1 }), readConfig({}))
    expect(watched[0]?.[0]?.[0]?.color).toBe(readConfig({}).colors.good)
    expect(watched[0]?.[0]?.[0]?.text).toBe('●')
    const off = buildLines(snapshot({ host }), readConfig({ show_remote: false }))
    expect(lineText(off[0] ?? [])).toStartWith('peer | ')
  })
})

describe('five-hour clock', () => {
  test('the hand sweeps a quarter for each 75 minutes of the window', () => {
    const at = (left: number) => fiveHourGlyph({ usedPercentage: 9, resetsAt: NOW + left * 60_000 }, NOW)
    expect([299, 225, 224, 150, 149, 75, 74, 1].map(at).join('')).toBe('◷◷◶◶◵◵◴◴')
    expect(fiveHourGlyph(null, NOW)).toBe('◷')
    expect(at(-1)).toBe('◷')
  })
})

describe('redraw schedule', () => {
  test('idle bands redraw once a minute', () => {
    expect(nextChangeMs(snapshot(), readConfig({}))).toBe(60_000)
  })

  test('a warm cache redraws when its minute ticks over, then every second', () => {
    const cfg = readConfig({ cache_ttl: '5m' })
    const warm = snapshot({ totals: { ...EMPTY_TOTALS, lastResponseAt: NOW - 30_500 } })
    expect(nextChangeMs(warm, cfg)).toBe(29_501)
    const last = snapshot({ totals: { ...EMPTY_TOTALS, lastResponseAt: NOW - 250_000 } })
    expect(nextChangeMs(last, cfg)).toBe(1000)
  })
})

describe('worktrees', () => {
  const repo = { ...emptyGit(''), branch: 'main' }
  const host = { sessionName: '', bridged: false, ide: '', agent: '', project: 'app' }

  test('the device-wide count of extra worktrees follows the folder', () => {
    const lines = buildLines(snapshot({ git: repo, host, worktrees: 3 }), readConfig({}))
    expect(lineText(lines[lines.length - 1] ?? [])).toBe('□ app | ⑂ 3 | ⎇ main ◻ 0 0 0 ≡ +0 -0')
    const one = buildLines(snapshot({ git: repo, host, worktrees: 1 }), readConfig({}))
    expect(lineText(one[one.length - 1] ?? [])).toBe('□ app | ⑂ 1 | ⎇ main ◻ 0 0 0 ≡ +0 -0')
  })

  test('a folder that is not a git repo still draws its name and the count', () => {
    const lines = buildLines(snapshot({ git: null, host: { ...host, project: 'Plugins' }, worktrees: 4 }), readConfig({}))
    expect(lineText(lines[lines.length - 1] ?? [])).toBe('□ Plugins | ⑂ 4')
  })

  test('no extra worktree on the device draws no count', () => {
    for (const worktrees of [undefined, 0]) {
      const lines = buildLines(snapshot({ git: repo, host, worktrees }), readConfig({}))
      expect(lineText(lines[lines.length - 1] ?? [])).toBe('□ app | ⎇ main ◻ 0 0 0 ≡ +0 -0')
    }
  })

  test('show_worktrees off hides the count', () => {
    const lines = buildLines(snapshot({ git: repo, host, worktrees: 2 }), readConfig({ show_worktrees: false }))
    expect(lineText(lines[lines.length - 1] ?? [])).not.toContain('⑂')
  })

  test('the porcelain list keeps checked-out worktrees and drops bare and prunable ones', () => {
    const porcelain = [
      'worktree C:/src/app',
      'HEAD 1111111',
      'branch refs/heads/main',
      '',
      'worktree C:/src/app-feat',
      'HEAD 2222222',
      'branch refs/heads/feat/x',
      '',
      'worktree C:/src/app-detached',
      'HEAD 3333333',
      'detached',
      '',
      'worktree C:/src/app-gone',
      'HEAD 4444444',
      'branch refs/heads/old',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree C:/src/bare.git',
      'bare',
    ].join('\r\n')
    expect(parseWorktrees(porcelain)).toEqual([
      { path: 'C:/src/app', branch: 'main' },
      { path: 'C:/src/app-feat', branch: 'feat/x' },
      { path: 'C:/src/app-detached', branch: '' },
    ])
  })

  test('a linked worktree reads its git dir from its .git file', () => {
    expect(worktreeGitDir('C:/src/app-feat', 'gitdir: C:\\src\\app\\.git\\worktrees\\app-feat\n')).toBe('C:/src/app/.git/worktrees/app-feat')
    expect(worktreeGitDir('/src/app-feat', 'gitdir: ../app/.git/worktrees/app-feat')).toBe('/src/app-feat/../app/.git/worktrees/app-feat')
    expect(worktreeGitDir('C:/src/app', null)).toBe('C:/src/app/.git')
  })

  test('paths compare across slash styles, and drive letters ignore case', () => {
    expect(samePath('C:\\src\\app\\', 'c:/src/app')).toBe(true)
    expect(samePath('/src/App', '/src/app')).toBe(false)
    expect(worktreeName('C:/src/app-feat/')).toBe('app-feat')
  })
})
