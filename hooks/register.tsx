import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type {
  IndexAgentStep,
  IndexEffort,
  IndexHarness,
  IndexPanel,
  IndexGit,
  IndexMergedPr,
  IndexPullRequest,
  IndexRateLimit,
  IndexTurnRecord,
  IndexUsage,
} from '../types'
import {
  EMPTY_TOTALS,
  MAIN,
  buildLines,
  MODEL_CHOICES,
  mergeRateLimit,
  modelLabel,
  nextChangeMs,
  normPath,
  createdLines,
  patchLineCounts,
  projectName,
  cacheLeftMs,
  gitLinks,
  readConfig,
  tint,
  type Config,
  type Seg,
  type ViewedAgent,
} from './format'
import {
  EFFORTS,
  PANELS,
  ROW_GAP,
  USAGE_DAYS,
  currentChoices,
  mainStep,
  FOLDER_PICK,
  panelLines,
  worktreePaths,
  rowOrder,
  savedEffortFor,
} from './panels'
import {
  BASE_REFS,
  COMMIT_FORMAT,
  GIT_SAFE_ENV,
  applyBase,
  applyPr,
  applyStatus,
  assembleRepos,
  belongsToRepo,
  commonDirAt,
  deviceTotal,
  emptyGit,
  gitArgv,
  isRecord,
  mapLimit,
  numstatTotals,
  parseCommitLog,
  parseJson,
  parseMergedPrs,
  parsePullRequests,
  parseSharedLimits,
  parseWorktrees,
  readRepo,
  samePath,
  serializeSharedLimits,
  slashPath,
  uniqueFolders,
  worktreeGitDir,
  worktreeName,
  type GitFs,
} from './git'
import { agentColorKey, parseAgentFile } from './agents'
import { dayKey, mergeLedger, parseLedger, serializeLedger, summarize, type LedgerEntry } from './ledger'
import { mergeTurns, parseTurns, serializeTurns, turnToRecord } from './turns'

const agents = atom({ plugin: 'the-index', key: 'agents' } as const, {})
const turn = atom({ plugin: 'the-index', key: 'turn' } as const, null)
const totals = atom({ plugin: 'the-index', key: 'totals' } as const, EMPTY_TOTALS)
const usage = atom({ plugin: 'the-index', key: 'usage' } as const, null)
const git = atom({ plugin: 'the-index', key: 'git' } as const, null)
const host = atom({ plugin: 'the-index', key: 'host' } as const, null)
const tick = atom({ plugin: 'the-index', key: 'tick' } as const, 0)
const clients = atom({ plugin: 'the-index', key: 'clients' } as const, {})
const agentEfforts = atom({ plugin: 'the-index', key: 'agentEfforts' } as const, {})
const agentModels = atom({ plugin: 'the-index', key: 'agentModels' } as const, {})
const pinned = atom({ plugin: 'the-index', key: 'pinned' } as const, [])
const slots = atom({ plugin: 'the-index', key: 'slots' } as const, [])
const hover = atom({ plugin: 'the-index', key: 'hover' } as const, null)
const harnesses = atom({ plugin: 'the-index', key: 'harnesses' } as const, null)
const ultracode = atom({ plugin: 'the-index', key: 'ultracode' } as const, false)
const agentColors = atom({ plugin: 'the-index', key: 'agentColors' } as const, {})
const callLog = atom({ plugin: 'the-index', key: 'callLog' } as const, [])
const usageSummary = atom({ plugin: 'the-index', key: 'usageSummary' } as const, null)
const contextLog = atom({ plugin: 'the-index', key: 'contextLog' } as const, [])
const contextLimit = atom({ plugin: 'the-index', key: 'contextLimit' } as const, null)
const baseCommits = atom({ plugin: 'the-index', key: 'baseCommits' } as const, [])
const branchCommits = atom({ plugin: 'the-index', key: 'branchCommits' } as const, [])
const mergedPrs = atom({ plugin: 'the-index', key: 'mergedPrs' } as const, [])
const turnHistory = atom({ plugin: 'the-index', key: 'turnHistory' } as const, [])
const basePrs = atom({ plugin: 'the-index', key: 'basePrs' } as const, [])
const worktrees = atom({ plugin: 'the-index', key: 'worktrees' } as const, [])
const deviceRepos = atom({ plugin: 'the-index', key: 'deviceRepos' } as const, [])

const EWMA_ALPHA = 0.3
const CONTEXT_LOG_MAX = 500
const BRANCH_COMMIT_LIMIT = 20
const MERGED_PR_LIMIT = 10
const BASE_PR_LIMIT = 10
const GIT_STAT_EVERY_MS = 30_000
const GIT_FULL_EVERY_MS = 300_000
const GIT_DEBOUNCE_MS = 2000
const HOST_MIN_GAP_MS = 300_000
const PR_CACHE_MS = 300_000
const prCache = new Map<string, { at: number; pr: { number: number; url: string } | null }>()
const GIT_STAMP_FILES = ['index', 'HEAD', 'FETCH_HEAD', 'ORIG_HEAD']
const DEVICE_EVERY_MS = 60_000
const DEVICE_LANES = 4

type Measured = {
  context: SessionContextUsage
  rateLimits: readonly SessionRateLimit[]
  cost?: SessionCost
}

function toLimit(rl: SessionRateLimit | undefined): IndexRateLimit | null {
  if (!rl) return null
  const resetsAt = rl.resetsAt ? Date.parse(rl.resetsAt) : 0
  return { usedPercentage: rl.percentUsed, resetsAt: Number.isFinite(resetsAt) ? resetsAt : 0 }
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return parseJson(await $.fs.read(path))
  } catch {
    return undefined
  }
}

async function listNames($: EngineInterface, dir: string): Promise<string[]> {
  try {
    return (await $.fs.list(dir)).map(entry => entry.name)
  } catch {
    return []
  }
}

async function tempDir($: EngineInterface): Promise<string> {
  const dir = (await $.env.get('TEMP')) || (await $.env.get('TMP')) || (await $.env.get('TMPDIR')) || '/tmp'
  return dir.replace(/[\\/]+$/, '')
}

async function configDir($: EngineInterface): Promise<string> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) return explicit.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${home.replace(/[\\/]+$/, '')}/.claude`
}

// The session registry is the CLI's own file, not part of the mod API: `name` is
// the peer name and `bridgeSessionId` marks a session linked to Remote Control.
async function sessionEntry(
  $: EngineInterface,
  dir: string,
  sessionId: string,
): Promise<{ name: string; bridged: boolean; bridgeId: string }> {
  for (const name of await listNames($, `${dir}/sessions`)) {
    if (!name.endsWith('.json')) continue
    const entry = await readJson($, `${dir}/sessions/${name}`)
    if (isRecord(entry) && entry['sessionId'] === sessionId) {
      const bridgeId = typeof entry['bridgeSessionId'] === 'string' ? entry['bridgeSessionId'] : ''
      return { name: String(entry['name'] ?? ''), bridged: bridgeId !== '', bridgeId }
    }
  }
  return { name: '', bridged: false, bridgeId: '' }
}

async function detectIde($: EngineInterface, dir: string, cwd: string): Promise<string> {
  const port = await $.env.get('CLAUDE_CODE_SSE_PORT')
  if (port) {
    const lock = await readJson($, `${dir}/ide/${port}.lock`)
    if (isRecord(lock) && lock['ideName']) return String(lock['ideName'])
  }
  const here = normPath(cwd)
  const matches = new Set<string>()
  for (const name of await listNames($, `${dir}/ide`)) {
    if (!name.endsWith('.lock')) continue
    const lock = await readJson($, `${dir}/ide/${name}`)
    if (!isRecord(lock) || !lock['ideName']) continue
    const folders = Array.isArray(lock['workspaceFolders']) ? lock['workspaceFolders'] : []
    if (folders.some(f => here === normPath(String(f)) || here.startsWith(`${normPath(String(f))}/`))) {
      matches.add(String(lock['ideName']))
    }
  }
  // Two IDEs on one folder is ambiguous: show neither rather than guess.
  return matches.size === 1 ? ([...matches][0] ?? '') : ''
}

async function runGit($: EngineInterface, cwd: string, args: readonly string[]): Promise<string> {
  try {
    const r = await $.process.run(gitArgv(cwd, args), { env: { ...GIT_SAFE_ENV }, timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function gitSnapshot($: EngineInterface, cwd: string): Promise<IndexGit | null> {
  const [status, diff, refsOut, remote] = await Promise.all([
    runGit($, cwd, ['status', '--porcelain=v2', '--branch']),
    runGit($, cwd, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', 'HEAD']),
    runGit($, cwd, ['for-each-ref', '--format=%(refname)\t%(symref)', ...BASE_REFS]),
    runGit($, cwd, ['config', '--get', 'remote.origin.url']),
  ])
  if (!status) return null
  const snap = emptyGit(remote)
  applyStatus(snap, status)
  if (!snap.branch) return snap
  const lines = numstatTotals(diff)
  snap.linesAdded = lines.added
  snap.linesRemoved = lines.removed
  applyBase(snap, refsOut)
  if (!snap.prBaseRef) return snap
  const [raw, leftRight] = await Promise.all([
    runGit($, cwd, ['diff', '--no-ext-diff', '--no-textconv', '--raw', '--numstat', `${snap.prBaseRef}...HEAD`]),
    runGit($, cwd, ['rev-list', '--left-right', '--count', `${snap.prBaseRef}...HEAD`]),
  ])
  applyPr(snap, raw, leftRight)
  snap.branchPushed = (await runGit($, cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${snap.branch}`])) !== ''
  if (snap.branchPushed && snap.branch !== snap.prBaseName && snap.repoWeb.includes('github')) {
    const pr = await openPr($, cwd, snap.branch)
    if (pr) {
      snap.prNumber = pr.number
      snap.prLink = pr.url
    }
  }
  return snap
}

async function openPr($: EngineInterface, cwd: string, branch: string): Promise<{ number: number; url: string } | null> {
  const now = await $.clock.now()
  const cached = prCache.get(branch)
  if (cached && now - cached.at < PR_CACHE_MS) return cached.pr
  let pr: { number: number; url: string } | null = null
  try {
    const r = await $.process.run(['gh', 'pr', 'view', branch, '--json', 'number,url,state'], { cwd, timeoutMs: 10_000 })
    const data = r.exitCode === 0 ? parseJson(r.stdout) : undefined
    if (isRecord(data) && data['state'] === 'OPEN' && typeof data['number'] === 'number' && typeof data['url'] === 'string') {
      pr = { number: data['number'], url: data['url'] }
    }
  } catch {
    pr = null
  }
  prCache.set(branch, { at: now, pr })
  return pr
}

const basePrCache = new Map<string, { at: number; prs: IndexPullRequest[] }>()
const mergedPrCache = new Map<string, { at: number; prs: IndexMergedPr[] }>()

async function mergedBasePrs($: EngineInterface, cwd: string, base: string): Promise<IndexMergedPr[]> {
  const now = await $.clock.now()
  const cached = mergedPrCache.get(base)
  if (cached && now - cached.at < PR_CACHE_MS) return cached.prs
  let prs: IndexMergedPr[] = []
  try {
    const fields = 'number,title,url,additions,deletions,changedFiles,createdAt,mergedAt,commits'
    const r = await $.process.run(
      ['gh', 'pr', 'list', '--base', base, '--state', 'merged', '--limit', String(MERGED_PR_LIMIT), '--json', fields],
      { cwd, timeoutMs: 15_000 },
    )
    prs = r.exitCode === 0 ? parseMergedPrs(parseJson(r.stdout)) : []
  } catch {
    prs = []
  }
  mergedPrCache.set(base, { at: now, prs })
  return prs
}

async function openBasePrs($: EngineInterface, cwd: string, base: string): Promise<IndexPullRequest[]> {
  const now = await $.clock.now()
  const cached = basePrCache.get(base)
  if (cached && now - cached.at < PR_CACHE_MS) return cached.prs
  let prs: IndexPullRequest[] = []
  try {
    const r = await $.process.run(
      ['gh', 'pr', 'list', '--base', base, '--state', 'open', '--limit', String(BASE_PR_LIMIT), '--json', 'number,title,url,headRefName'],
      { cwd, timeoutMs: 10_000 },
    )
    prs = r.exitCode === 0 ? parsePullRequests(parseJson(r.stdout)) : []
  } catch {
    prs = []
  }
  basePrCache.set(base, { at: now, prs })
  return prs
}

async function refreshGit($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const snap = await gitSnapshot($, cwd)
  await update($, git, () => snap)
  const base = snap?.prBaseRef ?? ''
  const onBase = !snap || snap.branch === snap.prBaseName
  const onGithub = Boolean(snap?.prBaseName && snap.repoWeb.includes('github'))
  const [branchLog, prs, merged] = await Promise.all([
    base && !onBase
      ? runGit($, cwd, ['log', '--no-ext-diff', '--no-textconv', `${base}..HEAD`, `-${BRANCH_COMMIT_LIMIT}`, '--numstat', '--summary', `--format=${COMMIT_FORMAT}`])
      : Promise.resolve(''),
    onGithub && snap ? openBasePrs($, cwd, snap.prBaseName) : Promise.resolve([]),
    onGithub && snap ? mergedBasePrs($, cwd, snap.prBaseName) : Promise.resolve([]),
  ])
  const baseLog =
    base && merged.length === 0 ? await runGit($, cwd, ['log', '--no-ext-diff', '--no-textconv', base, '-10', '--numstat', '--summary', `--format=${COMMIT_FORMAT}`]) : ''
  await update($, branchCommits, () => parseCommitLog(branchLog))
  await update($, basePrs, () => prs)
  await update($, mergedPrs, () => merged)
  await update($, baseCommits, () => parseCommitLog(baseLog))
}

async function refreshWorktrees($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [listed, top] = await Promise.all([
    runGit($, cwd, ['worktree', 'list', '--porcelain']),
    runGit($, cwd, ['rev-parse', '--show-toplevel']),
  ])
  const trees = await Promise.all(
    parseWorktrees(listed).map(async entry => {
      const dotGit = await $.fs.read(`${entry.path}/.git`).catch(() => null)
      return { path: entry.path, current: samePath(entry.path, top), gitDir: worktreeGitDir(entry.path, dotGit) }
    }),
  )
  const others = trees.filter(t => !t.current && belongsToRepo(t.gitDir, commonDir))
  worktreeDirs = others.map(t => t.gitDir)
  const snaps = new Map(await Promise.all(others.map(async t => [t.path, await gitSnapshot($, t.path)] as const)))
  await update($, worktrees, () =>
    trees.length > 1 ? trees.map(t => ({ path: t.path, name: worktreeName(t.path), current: t.current, git: snaps.get(t.path) ?? null })) : [],
  )
}

async function worktreeStamp($: EngineInterface): Promise<string> {
  if (!commonDir) return ''
  const stamps = await Promise.all([
    $.fs.stat(`${commonDir}/worktrees`).then(
      st => String(st.mtimeMs),
      () => '-',
    ),
    ...worktreeDirs.map(dir => gitStamp($, dir)),
  ])
  return stamps.join(';')
}

function refreshWorktreesSoon($: EngineInterface): void {
  worktreeTimer?.cancel()
  worktreeTimer = $.clock.after(GIT_DEBOUNCE_MS, () => {
    void refreshWorktrees($).then(async () => {
      lastWorktreeStamp = await worktreeStamp($)
    })
  })
}

function gitFs($: EngineInterface): GitFs {
  return {
    read: path => $.fs.read(path).catch(() => null),
    kind: path => $.fs.stat(path).then(
      st => st.kind,
      () => null,
    ),
    dirs: path => $.fs.list(path).then(
      entries => entries.filter(entry => entry.kind === 'dir').map(entry => entry.name),
      () => [],
    ),
  }
}

async function refreshDevice($: EngineInterface): Promise<void> {
  if (deviceBusy) return
  deviceBusy = true
  try {
    const cwd = await $.session.cwd()
    const fs = gitFs($)
    const children = (await fs.dirs(cwd)).map(name => `${slashPath(cwd)}/${name}`)
    const found = await mapLimit(children, DEVICE_LANES, folder => commonDirAt(fs, folder))
    const reads = await mapLimit(uniqueFolders([commonDir, ...found].filter(Boolean)), DEVICE_LANES, dir => readRepo(fs, dir))
    await update($, deviceRepos, () => assembleRepos(reads, commonDir))
  } finally {
    deviceBusy = false
  }
}

async function worktreeListStamp($: EngineInterface): Promise<string> {
  if (!commonDir) return ''
  return $.fs.stat(`${commonDir}/worktrees`).then(
    st => String(st.mtimeMs),
    () => '-',
  )
}

async function gitStamp($: EngineInterface, gitDir: string): Promise<string> {
  if (!gitDir) return ''
  const stamps = await Promise.all(
    GIT_STAMP_FILES.map(f =>
      $.fs.stat(`${gitDir}/${f}`).then(
        st => String(st.mtimeMs),
        () => '-',
      ),
    ),
  )
  return stamps.join(',')
}

async function nextTickDelay($: EngineInterface, cfg: Config): Promise<number> {
  const [sums, measured, now] = await Promise.all([read($, totals), read($, usage), $.clock.now()])
  return nextChangeMs(
    { now, agents: {}, turn: null, totals: sums, usage: measured, git: null, host: null, clients: 0, agentEfforts: {}, agentModels: {} },
    cfg,
  )
}

async function refreshHost($: EngineInterface): Promise<void> {
  const [cwd, id, settings, dir, version] = await Promise.all([
    $.session.cwd(),
    $.session.id(),
    $.settings.read(),
    configDir($),
    $.session.version(),
  ])
  const [entry, ide] = await Promise.all([sessionEntry($, dir, id), detectIde($, dir, cwd), loadAgentColors($)])
  const agentSetting = settings['agent']
  await update($, host, () => ({
    sessionName: entry.name,
    sessionId: id,
    bridged: entry.bridged,
    bridgeId: entry.bridgeId,
    cwd,
    version: version.version,
    ide,
    agent: typeof agentSetting === 'string' ? agentSetting : '',
    project: projectName(cwd),
  }))
}

function commandText(result: unknown): string {
  return typeof result === 'object' && result !== null && 'text' in result ? String(result.text ?? '') : ''
}

async function switchMainModel($: EngineInterface, alias: string, id: string | undefined): Promise<void> {
  const text = commandText(await $.command.run({ command: 'model', args: alias }))
  if (text) $.ui.toast(text.replace(/`/g, ''))
  const named = /`([^`]+?)(?: \(default\))?`/.exec(text)?.[1]
  const shown = id ?? named
  if (shown) await followModel($, shown)
}

async function followModel($: EngineInterface, model: string): Promise<void> {
  const effort = savedEffortFor(await $.settings.read(), model)
  await update($, agents, prev => ({ ...prev, [MAIN]: { model, effort: effort ?? prev[MAIN]?.effort } }))
}

// Windows: the shell's Open brings the window to the front (explorer.exe opens it behind the
// focused app). The target travels in an environment variable, never inside the -Command
// script, so quotes in a path or URL can't end the string and run code.
async function shellOpen($: EngineInterface, target: string): Promise<void> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const openers: [readonly string[], Record<string, string>?][] = isWindows
    ? [[['powershell', '-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Shell.Application).Open($env:THE_INDEX_OPEN)'], { THE_INDEX_OPEN: target }]]
    : // macOS has `open`; Linux has xdg-open, and its `open` (openvt) exits non-zero, so each is tried in turn.
      [[['open', target]], [['xdg-open', target]]]
  for (const [argv, env] of openers) {
    try {
      const r = await $.process.run(argv, env ? { timeoutMs: 10_000, env } : { timeoutMs: 10_000 })
      if (r.exitCode === 0) return
    } catch {
      continue
    }
  }
  $.ui.toast(`Could not open ${target}`)
}

async function openUrl($: EngineInterface, href: string): Promise<void> {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return
  }
  if (url.protocol === 'https:') await shellOpen($, url.href)
}

async function openFolder($: EngineInterface, path?: string): Promise<void> {
  const dir = path ?? (await $.session.cwd())
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  await shellOpen($, isWindows ? dir.replace(/\//g, '\\') : dir)
}

async function switchMainEffort($: EngineInterface, level: IndexEffort | 'auto'): Promise<void> {
  const result = await $.command.run({ command: 'effort', args: String(level) })
  const text = commandText(result)
  if (text) $.ui.toast((text.split(':')[0] ?? text).replace(/`/g, ''))
  await update($, agents, prev => ({ ...prev, [MAIN]: { model: prev[MAIN]?.model ?? '', effort: level } }))
}

async function loadAgentColors($: EngineInterface): Promise<void> {
  const [cwd, dir] = await Promise.all([$.session.cwd(), configDir($)])
  const found: Record<string, string> = {}
  for (const agentsDir of [`${dir}/agents`, `${cwd.replace(/[\\/]+$/, '')}/.claude/agents`]) {
    for (const name of await listNames($, agentsDir)) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const text = await $.fs.read(`${agentsDir}/${name}`).catch(() => '')
      const agent = parseAgentFile(text, name)
      if (agent?.color) found[agent.name] = agent.color
      else if (agent) delete found[agent.name]
    }
  }
  const before = await read($, agentColors)
  if (JSON.stringify(before) !== JSON.stringify(found)) await update($, agentColors, () => found)
}

async function refreshLinkUntilLinked($: EngineInterface): Promise<void> {
  const current = await read($, host)
  if (!current || current.bridged) return
  const [dir, id] = await Promise.all([configDir($), $.session.id()])
  const entry = await sessionEntry($, dir, id)
  if (!entry.bridged && entry.name === current.sessionName) return
  await update($, host, prev => (prev ? { ...prev, sessionName: entry.name, bridged: entry.bridged, bridgeId: entry.bridgeId } : prev))
}

// Shares claude-statusline-ratelimits.json with statusline.py: same path and
// seconds-based shape, so the script and the band agree across open sessions.
async function recordUsage($: EngineInterface, m: Measured): Promise<void> {
  const sharedPath = `${await tempDir($)}/claude-statusline-ratelimits.json`
  const shared = parseSharedLimits(await readJson($, sharedPath))
  const fiveHour = mergeRateLimit([toLimit(m.rateLimits.find(r => r.kind === 'five_hour')), shared.fiveHour])
  const sevenDay = mergeRateLimit([toLimit(m.rateLimits.find(r => r.kind === 'seven_day')), shared.sevenDay])
  const merged = { fiveHour, sevenDay }
  const text = serializeSharedLimits(merged)
  if ((fiveHour || sevenDay) && text !== serializeSharedLimits(shared)) {
    await $.fs.write(sharedPath, text).catch(() => undefined)
  }

  const [{ startedAt }, now] = await Promise.all([$.session.usage(), $.clock.now()])
  const pct = m.context.percent ?? null
  await update($, usage, (prev): IndexUsage => ({
    startedAt,
    contextPercent: pct,
    contextTokens: m.context.tokens ?? null,
    costUsd: m.cost?.usd ?? null,
    fiveHour,
    sevenDay,
    compactions: prev?.compactions ?? 0,
  }))
  await update($, contextLimit, prev =>
    prev?.window === m.context.window ? prev : { window: m.context.window, threshold: prev?.threshold ?? null },
  )
  if (pct === null) return
  const compaction = pendingCompaction
  pendingCompaction = undefined
  await update($, contextLog, prev => {
    const last = prev[prev.length - 1]
    if (last && last.percent === pct && !compaction) return prev
    const point = { at: now, percent: pct, tokens: m.context.tokens ?? null, ...(compaction ? { compaction } : {}) }
    return [...prev.slice(-(CONTEXT_LOG_MAX - 1)), point]
  })
}

let pendingCompaction: 'manual' | 'auto' | 'plugin' | undefined

async function refreshCompactThreshold($: EngineInterface): Promise<void> {
  try {
    const measured = await $.session.usage({ breakdown: 'summary' })
    const breakdown = measured.context.breakdown
    const threshold = breakdown?.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null
    await update($, contextLimit, () => ({ window: measured.context.window, threshold }))
  } catch {
    // Without a bound session the breakdown rejects; the chart then draws no threshold line.
  }
}

async function recordEdit($: EngineInterface, result: unknown, isMainLoop: boolean, path: string | undefined): Promise<void> {
  if (!isRecord(result) || result['staged'] === true) return
  const patch = Array.isArray(result['structuredPatch']) ? (result['structuredPatch'] as { lines: string[] }[]) : []
  const counted = patchLineCounts(patch)
  const created = result['type'] === 'create' && patch.length === 0 && typeof result['content'] === 'string'
  const added = created ? createdLines(String(result['content'])) : counted.added
  const removed = counted.removed
  if (!added && !removed) return
  await update($, totals, prev => ({
    ...prev,
    linesAdded: prev.linesAdded + added,
    linesRemoved: prev.linesRemoved + removed,
  }))
  await update($, turn, prev =>
    prev
      ? {
          ...prev,
          linesAdded: prev.linesAdded + added,
          linesRemoved: prev.linesRemoved + removed,
          files: path && !prev.files.includes(path) ? [...prev.files, path] : prev.files,
        }
      : prev,
  )
  if (!isMainLoop) return
  await update($, callLog, prev => {
    const last = prev[prev.length - 1]
    if (!last) return prev
    const files = path && !(last.files ?? []).includes(path) ? [...(last.files ?? []), path] : last.files
    const credited = {
      ...last,
      linesAdded: (last.linesAdded ?? 0) + added,
      linesRemoved: (last.linesRemoved ?? 0) + removed,
      ...(files ? { files } : {}),
    }
    return [...prev.slice(0, -1), credited]
  })
}

const CALL_LOG_MAX = 500
const LEDGER_WRITE_MS = 5000
const LEDGER_FILE = 'the-index-usage.json'
const TURNS_FILE = 'the-index-turns.json'
let turnsMine: IndexTurnRecord[] = []
let turnsDirty = false
let turnsLoaded = false
const ledgerMine: Record<string, LedgerEntry> = {}
let ledgerCost: number | null = null
let ledgerTimer: Timer | undefined
let ledgerLoaded = false

async function syncLedger($: EngineInterface): Promise<void> {
  const [dir, sessionId, now] = await Promise.all([configDir($), $.session.id(), $.clock.now()])
  const path = `${dir}/${LEDGER_FILE}`
  const onDisk = parseLedger(await readJson($, path))
  if (!ledgerLoaded) {
    ledgerLoaded = true
    for (const [date, sessions] of Object.entries(onDisk)) {
      const entry = sessions[sessionId]
      if (entry && !ledgerMine[date]) ledgerMine[date] = entry
    }
  }
  const merged = mergeLedger(onDisk, sessionId, ledgerMine)
  if (Object.keys(ledgerMine).length > 0) await $.fs.write(path, serializeLedger(merged)).catch(() => undefined)
  await update($, usageSummary, () => summarize(merged, dayKey(now), USAGE_DAYS))

  const turnsPath = `${dir}/${TURNS_FILE}`
  const turnsOnDisk = parseTurns(await readJson($, turnsPath))
  if (!turnsLoaded) {
    turnsLoaded = true
    const known = new Set(turnsMine.map(t => t.id))
    turnsMine = [...turnsOnDisk.filter(t => t.session === sessionId && !known.has(t.id)), ...turnsMine]
  }
  const turns = mergeTurns(turnsOnDisk, sessionId, turnsMine, now)
  if (turnsDirty) {
    turnsDirty = false
    await $.fs.write(turnsPath, serializeTurns(turns)).catch(() => undefined)
  }
  await update($, turnHistory, () => turns)
}

async function startSessionShare($: EngineInterface): Promise<void> {
  for (const day of Object.keys(ledgerMine)) delete ledgerMine[day]
  turnsMine = []
  ledgerLoaded = false
  turnsLoaded = false
  ledgerCost = (await $.session.usage()).cost?.usd ?? null
  await update($, turn, () => null)
}

async function recordTurn($: EngineInterface, turnId: string): Promise<void> {
  const live = await read($, turn)
  if (live?.turnId !== turnId) return
  const [session, measured] = await Promise.all([$.session.id(), $.session.usage()])
  const record = turnToRecord(live, session, measured.cost?.usd ?? null)
  turnsMine = [...turnsMine.filter(t => t.id !== record.id), record]
  turnsDirty = true
  await update($, turnHistory, prev => [...prev.filter(t => t.id !== record.id), record])
  syncLedgerSoon($)
}

function syncLedgerSoon($: EngineInterface): void {
  ledgerTimer?.cancel()
  ledgerTimer = $.clock.after(LEDGER_WRITE_MS, () => {
    void syncLedger($)
  })
}

async function recordStep($: EngineInterface, tokens: number): Promise<void> {
  const [now, measured] = await Promise.all([$.clock.now(), $.session.usage()])
  const cost = measured.cost?.usd ?? null
  const day = dayKey(now)
  const entry = (ledgerMine[day] ??= { tokens: 0, costStart: ledgerCost ?? cost, costEnd: cost })
  entry.tokens += tokens
  if (cost !== null) {
    entry.costEnd = cost
    ledgerCost = cost
  }
  syncLedgerSoon($)
}

let tickTimer: Timer | undefined
let gitTimer: Timer | undefined
let gitDir = ''
let lastStamp = ''
let worktreeTimer: Timer | undefined
let commonDir = ''
let worktreeDirs: string[] = []
let lastWorktreeStamp = ''
let lastListStamp = ''
let deviceBusy = false
let hostAt = 0

function scheduleTick($: EngineInterface, cfg: Config): void {
  void nextTickDelay($, cfg).then(ms => {
    tickTimer?.cancel()
    tickTimer = $.clock.after(ms, () => {
      void $.clock
        .now()
        .then(now => update($, tick, () => now))
        .finally(() => scheduleTick($, cfg))
    })
  })
}

function refreshGitSoon($: EngineInterface): void {
  gitTimer?.cancel()
  gitTimer = $.clock.after(GIT_DEBOUNCE_MS, () => {
    void refreshGit($).then(async () => {
      lastStamp = await gitStamp($, gitDir)
    })
  })
}

const AGENT_TABS = 'plugin:ide-agent-tabs:ide-agent-tabs'
const ULTRACODE = /\bultracode\b/i
const PIN_ON = '■'
const PIN_OFF = '□'
const PIN_SPACE = ' '

function setPinned($: EngineInterface, panel: IndexPanel, isPinned: boolean): Promise<unknown> {
  return update($, pinned, list => {
    const rest = list.filter(p => p !== panel)
    return isPinned ? [...rest, panel] : rest
  })
}

const HOVER_OPEN_MS = 300
const HOVER_CLOSE_MS = 300
const FADE_OUT_FALLBACK_MS = 1000
let hoverTimer: Timer | undefined
const pointerOver = new Set<string>()

function forgetPointer(panel: IndexPanel): void {
  for (const key of [...pointerOver]) if (key.startsWith(`${panel}-`)) pointerOver.delete(key)
}

// A row taken off the band never posts its leave, so its pointer keys would keep the panel open.
function forgetRow(panel: IndexPanel): void {
  pointerOver.delete(`${panel}-row`)
  pointerOver.delete(`${panel}-pin`)
}

async function placeSlot($: EngineInterface, panel: IndexPanel): Promise<void> {
  if (panel === 'worktrees') {
    refreshWorktreesSoon($)
    void refreshDevice($)
  }
  const pinnedList = await read($, pinned)
  await update($, slots, list => {
    const live = list.filter(p => p === panel || pinnedList.includes(p))
    for (const p of list) if (!live.includes(p)) forgetRow(p)
    return live.includes(panel) ? live : [...live, panel]
  })
}

function dropSlot($: EngineInterface, panel: IndexPanel): Promise<unknown> {
  forgetRow(panel)
  return update($, slots, list => list.filter(p => p !== panel))
}

function hoverOpenSoon($: EngineInterface, panel: IndexPanel): void {
  hoverTimer?.cancel()
  hoverTimer = $.clock.after(HOVER_OPEN_MS, () => {
    void placeSlot($, panel).then(() => update($, hover, () => ({ panel, closing: false })))
  })
}

async function hoverKeep($: EngineInterface, panel: IndexPanel): Promise<void> {
  const h = await read($, hover)
  if (h && h.panel !== panel) return
  hoverTimer?.cancel()
  if (h?.closing) await update($, hover, () => ({ ...h, closing: false }))
}

function hoverCloseSoon($: EngineInterface): void {
  hoverTimer?.cancel()
  hoverTimer = $.clock.after(HOVER_CLOSE_MS, () => {
    void update($, hover, h => (h && !h.closing ? { ...h, closing: true } : h))
    hoverTimer = $.clock.after(FADE_OUT_FALLBACK_MS, () => {
      void hoverClose($)
    })
  })
}

async function hoverClose($: EngineInterface): Promise<void> {
  hoverTimer?.cancel()
  const [closing, pinnedList] = await Promise.all([read($, hover), read($, pinned)])
  await update($, hover, () => null)
  if (closing && !pinnedList.includes(closing.panel)) await dropSlot($, closing.panel)
}

async function togglePin($: EngineInterface, panel: IndexPanel): Promise<void> {
  hoverTimer?.cancel()
  const wasPinned = (await read($, pinned)).includes(panel)
  await setPinned($, panel, !wasPinned)
  if (!wasPinned) {
    await placeSlot($, panel)
  } else if ([...pointerOver].some(key => key.startsWith(`${panel}-`))) {
    await update($, hover, () => ({ panel, closing: false }))
  } else {
    await dropSlot($, panel)
  }
}

function mcpJson(result: unknown): unknown {
  if (!isRecord(result) || result['isError'] === true || !Array.isArray(result['content'])) return undefined
  const first: unknown = result['content'][0]
  return isRecord(first) && typeof first['text'] === 'string' ? parseJson(first['text']) : undefined
}

async function loadHarnesses($: EngineInterface): Promise<void> {
  let list: IndexHarness[] | null = null
  try {
    const data = mcpJson(await $.mcp.call(AGENT_TABS, 'list_agents'))
    const agentsList = isRecord(data) && Array.isArray(data['agents']) ? data['agents'] : []
    list = agentsList.flatMap(a =>
      isRecord(a) && a['installed'] === true && typeof a['name'] === 'string'
        ? [{ name: a['name'], label: typeof a['label'] === 'string' ? a['label'] : a['name'] }]
        : [],
    )
  } catch {
    list = null
  }
  await update($, harnesses, () => (list && list.length > 0 ? list : null))
}

async function openHarness($: EngineInterface, name: string): Promise<void> {
  const label = (await read($, harnesses))?.find(h => h.name === name)?.label ?? name
  try {
    const result = await $.mcp.call(AGENT_TABS, 'open_tab', { agent: name, path: await $.session.cwd() })
    $.ui.toast(isRecord(result) && result['isError'] === true ? `Could not open ${label}` : `Opened ${label} in a new tab`)
  } catch {
    $.ui.toast(`Could not open ${label}: agent tabs is not available`)
  }
}

async function toggleUltracode($: EngineInterface): Promise<void> {
  const { text } = await $.prompt.read()
  const next = ULTRACODE.test(text)
    ? text.replace(new RegExp(ULTRACODE.source, 'gi'), '').replace(/\s{2,}/g, ' ').trim()
    : `${text.trimEnd()}${text.trim() ? ' ' : ''}ultracode`
  await $.prompt.fill({ text: next, mode: 'replace' })
  await update($, ultracode, () => ULTRACODE.test(next))
}

async function applyPick($: EngineInterface, panel: IndexPanel, target: string, pick: string): Promise<void> {
  if (panel === 'branch' || panel === 'base') {
    await openUrl($, pick)
    return
  }
  if (panel === 'worktrees') {
    const path = pick.startsWith(FOLDER_PICK) ? pick.slice(FOLDER_PICK.length) : ''
    if (!path) await openUrl($, pick)
    else if (worktreePaths({ worktrees: await read($, worktrees), deviceRepos: await read($, deviceRepos) }).some(p => samePath(p, path))) {
      await openFolder($, path)
    }
    return
  }
  if (panel === 'effort' && pick === 'ultracode') {
    await toggleUltracode($)
    return
  }
  if (panel === 'harness') {
    await openHarness($, pick)
  } else if (panel === 'effort') {
    const level = EFFORTS.find(l => l === pick)
    if (!level && pick !== 'default') return
    if (target === MAIN) await switchMainEffort($, level ?? 'auto')
    else {
      await update($, agentEfforts, prev => {
        const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== target))
        return level ? { ...rest, [target]: level } : rest
      })
    }
  } else if (panel === 'model') {
    const choice = MODEL_CHOICES.find(c => c.alias === pick)
    if (!choice && pick !== 'default') return
    if (target === MAIN) await switchMainModel($, choice?.alias ?? 'default', choice?.id)
    else {
      await update($, agentModels, prev => {
        const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== target))
        return choice ? { ...rest, [target]: choice.id } : rest
      })
    }
  } else {
    return
  }
  hoverTimer?.cancel()
  forgetPointer(panel)
  await setPinned($, panel, false)
  await Promise.all([update($, hover, () => null), dropSlot($, panel)])
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'index-effort', description: "Open the band's effort row" })
    const cwd = await $.session.cwd()
    gitDir = (await runGit($, cwd, ['rev-parse', '--absolute-git-dir'])).replace(/\\/g, '/')
    commonDir = (await runGit($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).replace(/\\/g, '/')
    await Promise.allSettled([
      refreshHost($),
      refreshGit($),
      refreshWorktrees($),
      loadHarnesses($),
      $.session.usage().then(u => {
        ledgerCost = u.cost?.usd ?? null
      }),
      syncLedger($),
      refreshCompactThreshold($),
      $.session.usage().then(u => recordUsage($, u)),
    ])
    hostAt = await $.clock.now()
    lastStamp = await gitStamp($, gitDir)
    lastWorktreeStamp = await worktreeStamp($)
    lastListStamp = await worktreeListStamp($)
    void refreshDevice($)
    scheduleTick($, cfg)
    $.clock.every(GIT_STAT_EVERY_MS, () => {
      void gitStamp($, gitDir).then(stamp => {
        if (stamp !== lastStamp) refreshGitSoon($)
      })
      void worktreeStamp($).then(stamp => {
        if (stamp !== lastWorktreeStamp) refreshWorktreesSoon($)
      })
      void worktreeListStamp($).then(stamp => {
        if (stamp === lastListStamp) return
        lastListStamp = stamp
        void refreshDevice($)
      })
    })
    $.clock.every(DEVICE_EVERY_MS, () => {
      void refreshDevice($)
    })
    $.clock.every(GIT_STAT_EVERY_MS, () => {
      void refreshLinkUntilLinked($)
    })
    $.clock.every(GIT_FULL_EVERY_MS, () => {
      refreshGitSoon($)
      refreshWorktreesSoon($)
      void syncLedger($)
      void refreshCompactThreshold($)
    })
    return result
  })

  on('ui.message', { component: 'AbovePrompt' }, async ($, e) => {
    const data = isRecord(e.data) ? e.data : {}
    if (e.element === 'project-chip') {
      if (data['press'] === true) await openFolder($)
      return {}
    }
    const panel = PANELS.find(p => e.element.startsWith(`${p}-`))
    if (!panel) return {}
    const isName = e.element === `${panel}-chip`
    if (data['hover'] === true) {
      pointerOver.add(e.element)
      if (isName && (await read($, hover))?.panel !== panel) hoverOpenSoon($, panel)
      else await hoverKeep($, panel)
    } else if (data['hover'] === false) {
      pointerOver.delete(e.element)
      if (![...pointerOver].some(key => key.startsWith(`${panel}-`))) hoverCloseSoon($)
    } else if (data['press'] === true && (isName || e.element === `${panel}-pin`)) {
      await togglePin($, panel)
    } else if (data['faded'] === true && e.element === `${panel}-row`) {
      const h = await read($, hover)
      if (h?.closing && h.panel === panel) await hoverClose($)
    } else if (panel === 'session' && data['pick'] === 'name' && e.element === `${panel}-row`) {
      const name = (await read($, host))?.sessionName
      if (name) {
        const copied = await $.ui.copy({ text: name, surface: e.surface })
        $.ui.toast(copied.isCopied ? `Copied: ${name}` : `Could not copy ${name}: ${copied.reason}`)
      }
    } else if (typeof data['pick'] === 'string' && e.element === `${panel}-row`) {
      await applyPick($, panel, typeof data['target'] === 'string' ? data['target'] : MAIN, data['pick'])
    }
    return {}
  })

  on('command.run', { command: 'index-effort' }, async $ => {
    await setPinned($, 'effort', true)
    await placeSlot($, 'effort')
    return { text: 'The effort row is open above the band. To set a level directly, run /effort.' }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      ledgerTimer?.cancel()
      await syncLedger($)
    }
    const result = await next(e)
    if (e.reason === 'clear') await startSessionShare($)
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.messages !== undefined) {
      pendingCompaction = e.trigger
      await update($, usage, prev => (prev ? { ...prev, compactions: prev.compactions + 1 } : prev))
      void refreshCompactThreshold($)
    }
    return result
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    void refreshCompactThreshold($)
    const ttlMs = e.cache_ttl === '5m' ? 300_000 : 3_600_000
    await followModel($, e.to_model)
    await update($, totals, prev => ({ ...prev, cacheTtlMs: ttlMs }))
    return result
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const arg = e.args.trim().toLowerCase()
    const level: IndexEffort | undefined = arg === 'auto' ? 'auto' : EFFORTS.find(l => l === arg)
    if (level) await update($, agents, prev => ({ ...prev, [MAIN]: { model: prev[MAIN]?.model ?? '', effort: level } }))
    return result
  })

  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    const isOn = ULTRACODE.test(result.text)
    if (isOn !== (await read($, ultracode))) await update($, ultracode, () => isOn)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (await read($, ultracode)) await update($, ultracode, () => false)
    return result
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (e.surface !== 'terminal') await update($, clients, prev => ({ ...prev, [e.clientId]: e.surface }))
    return result
  })

  on('session.detach', async ($, e, next) => {
    const result = await next(e)
    await update($, clients, prev => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== e.clientId)))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await recordUsage($, e)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const key = e.agentId ?? MAIN
    const [chosenEfforts, chosenModels] = await Promise.all([read($, agentEfforts), read($, agentModels)])
    const chosen = chosenEfforts[key]
    const chosenModel = chosenModels[key]
    const effort = chosen ?? e.effort
    const model = chosenModel ?? e.model
    await update($, agents, prev => ({ ...prev, [key]: { model, effort } }))
    const costBefore = e.agentId === undefined ? ((await $.session.usage()).cost?.usd ?? null) : null
    const startedAt = await $.clock.now()
    const sent = chosen === undefined && chosenModel === undefined ? e : { ...e, model, effort }
    const result = yield* next(sent)
    const answeredBy = result.usage?.model
    if (answeredBy) await update($, agents, prev => ({ ...prev, [key]: { model: answeredBy, effort } }))
    if (chosenModel !== undefined && result.stopReason === null && !result.usage) {
      await update($, agentModels, prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))
      await update($, agents, prev => ({ ...prev, [key]: { model: e.model, effort } }))
      $.ui.toast(`${modelLabel(chosenModel)} did not answer, so the band went back to the session's model.`)
    }
    const stepUsage = result.usage
    if (stepUsage) {
      await recordStep(
        $,
        stepUsage.input_tokens + stepUsage.cache_creation_input_tokens + stepUsage.cache_read_input_tokens + stepUsage.output_tokens,
      )
    }
    if (e.agentId !== undefined || !result.usage) return result

    const endedAt = await $.clock.now()
    const u = result.usage
    const apiMs = endedAt - startedAt
    const cost = (await $.session.usage()).cost?.usd ?? null
    const callCost = cost === null || costBefore === null ? null : Math.max(0, cost - costBefore)
    const newTurn = (await read($, turn))?.turnId !== e.turnId
    const totalIn = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
    const hitFrac = totalIn > 0 ? u.cache_read_input_tokens / totalIn : 0

    await update($, totals, prev => {
      return {
        ...prev,
        requests: prev.requests + 1,
        ...(prev.turns === undefined ? {} : { turns: prev.turns + (newTurn ? 1 : 0) }),
        input: prev.input + u.input_tokens,
        // Totals kept from an earlier build stay without the counts it lacked: a count from mid-session would read low.
        output: prev.output === undefined ? undefined : prev.output + u.output_tokens,
        ...(prev.tpsSum === undefined || prev.tpsCalls === undefined
          ? {}
          : u.output_tokens > 0 && apiMs > 0
            ? { tpsSum: prev.tpsSum + u.output_tokens / (apiMs / 1000), tpsCalls: prev.tpsCalls + 1 }
            : { tpsSum: prev.tpsSum, tpsCalls: prev.tpsCalls }),
        cacheWrite: prev.cacheWrite + u.cache_creation_input_tokens,
        cacheRead: prev.cacheRead + u.cache_read_input_tokens,
        apiMs: prev.apiMs + apiMs,
        ewmaHit: prev.ewmaHit === null ? hitFrac : EWMA_ALPHA * hitFrac + (1 - EWMA_ALPHA) * prev.ewmaHit,
        lastResponseAt: endedAt,
      }
    })
    scheduleTick($, cfg)
    await update($, turn, prev => {
      const base =
        prev?.turnId === e.turnId
          ? prev
          : {
              turnId: e.turnId,
              calls: 0,
              input: 0,
              cacheWrite: 0,
              cacheRead: 0,
              output: 0,
              apiMs: 0,
              costStartUsd: costBefore,
              costUsd: null,
              linesAdded: 0,
              linesRemoved: 0,
              files: [],
              start: startedAt,
              end: endedAt,
            }
      return {
        ...base,
        calls: base.calls + 1,
        input: base.input + u.input_tokens,
        cacheWrite: base.cacheWrite + u.cache_creation_input_tokens,
        cacheRead: base.cacheRead + u.cache_read_input_tokens,
        output: base.output + u.output_tokens,
        apiMs: base.apiMs + apiMs,
        end: endedAt,
        // A turn costs the session cost's rise from its first call, so subagents it ran count.
        costUsd: cost === null || base.costStartUsd === null ? null : Math.max(0, cost - base.costStartUsd),
      }
    })
    await update($, callLog, prev => [
      ...prev.slice(-(CALL_LOG_MAX - 1)),
      {
        at: endedAt,
        turnId: e.turnId,
        tokens: totalIn + u.output_tokens,
        input: totalIn,
        cacheWrite: u.cache_creation_input_tokens,
        cacheRead: u.cache_read_input_tokens,
        linesAdded: 0,
        linesRemoved: 0,
        output: u.output_tokens,
        apiMs,
        costUsd: callCost,
      },
    ])
    return result
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    if ((e.tool === 'Edit' || e.tool === 'Write') && !r.isError) {
      const path: unknown = e.file_path
      await recordEdit($, r.result, e.agentId === undefined, typeof path === 'string' ? path : undefined)
    }
    if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'Bash') refreshGitSoon($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await recordTurn($, e.turnId)
    refreshGitSoon($)
    const now = await $.clock.now()
    if (now - hostAt >= HOST_MIN_GAP_MS) {
      hostAt = now
      void refreshHost($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const table = $.ui.resolve(e)
    const Client = 'Client' in table ? table.Client : undefined
    if (!Client) return next(e)
    const { Box, Text } = table

    const [agentSteps, liveTurn, sums, measured, repo, hostInfo, , remotes, efforts, models, pinnedList, slotOrder, hovering, harnessList, ultracodeOn, colorOf, summary, contextPoints, limit, commits, branchLog, merged, prs, history, trees, device] =
      await Promise.all([
        read($, agents),
        read($, turn),
        read($, totals),
        read($, usage),
        read($, git),
        read($, host),
        read($, tick),
        read($, clients),
        read($, agentEfforts),
        read($, agentModels),
        read($, pinned),
        read($, slots),
        read($, hover),
        read($, harnesses),
        read($, ultracode),
        read($, agentColors),
        read($, usageSummary),
        read($, contextLog),
        read($, contextLimit),
        read($, baseCommits),
        read($, branchCommits),
        read($, mergedPrs),
        read($, basePrs),
        read($, turnHistory),
        read($, worktrees),
        read($, deviceRepos),
      ])
    const [now, liveModel, settings] = await Promise.all([$.clock.now(), $.session.model(), $.settings.read()])
    const steps: Readonly<Record<string, IndexAgentStep>> = { ...agentSteps, [MAIN]: mainStep(liveModel, agentSteps[MAIN], settings) }

    let viewed: ViewedAgent | undefined
    const agentId = e.props.view.agentId
    if (agentId !== undefined && cfg.show.agent_view) {
      const info = (await $.agent.list()).find(a => a.id === agentId)
      const label = info?.name ?? info?.description ?? ''
      viewed = {
        id: agentId,
        type: info?.type ?? 'agent',
        status: info?.status ?? 'unknown',
        label: label.length > 40 ? `${label.slice(0, 39)}…` : label,
      }
    }

    const agentColor = colorOf[viewed?.type ?? ''] ?? colorOf[hostInfo?.agent ?? '']
    const look = tint(cfg, agentColorKey(agentColor))
    const attached = Object.keys(remotes).length
    const lines = buildLines(
      {
        now,
        agents: steps,
        turn: liveTurn,
        totals: sums,
        usage: measured,
        git: repo,
        host: hostInfo,
        clients: attached,
        agentEfforts: efforts,
        agentModels: models,
        worktrees: deviceTotal(device),
      },
      look,
      viewed,
    )
    if (lines.length === 0) return next(e)

    const target = viewed?.id ?? MAIN
    const view = {
      cfg: look,
      choices: currentChoices(target, steps[target], { model: models[target], effort: efforts[target] }, settings),
      harnesses: harnessList,
      ultracode: ultracodeOn,
      contextTokens: measured?.contextTokens ?? null,
      host: hostInfo,
      agentColor,
      startedAt: measured?.startedAt ?? null,
      attached,
      turn: liveTurn,
      sessionCostUsd: measured?.costUsd ?? null,
      usage: summary,
      contextLog: contextPoints,
      contextLimit: limit,
      baseCommits: commits,
      baseRef: repo?.prBaseRef ?? '',
      branchCommits: branchLog,
      uncommitted:
        repo && repo.linesAdded + repo.linesRemoved + repo.filesAdded + repo.filesModified + repo.filesDeleted > 0
          ? { added: repo.linesAdded, removed: repo.linesRemoved, filesAdded: repo.filesAdded, filesModified: repo.filesModified, filesDeleted: repo.filesDeleted }
          : null,
      mergedPrs: merged,
      turnHistory: history,
      links: gitLinks(repo),
      basePrs: prs,
      worktrees: trees.map(t => (t.current ? { ...t, git: repo } : t)),
      deviceRepos: device,
      cacheLeftMs: cfg.show.cache ? cacheLeftMs(sums, cfg, now) : null,
      now,
    }
    const isPinned = (panel: IndexPanel) => pinnedList.includes(panel)

    const panelBlock = (panel: IndexPanel) => {
      const rows = panelLines(panel, view)
      if (rows.length === 0) return null
      const isPinnedRow = isPinned(panel)
      return (
        <Box key={`${panel}-block`} flexDirection="row" gap={1}>
          <Box flexDirection="column">
            <Client
              key={`${panel}-pin`}
              module="./chip.tsx"
              props={{ text: isPinnedRow ? PIN_ON : PIN_OFF, color: look.colors.model }}
            />
            {rows.slice(1).map((_, i) => (
              <Text key={`${panel}-pin-space${i}`}>{PIN_SPACE}</Text>
            ))}
          </Box>
          <Client
            key={`${panel}-row`}
            module="./row.tsx"
            props={{
              lines: rows,
              gap: ROW_GAP,
              hoverColor: look.colors.model,
              fade: true,
              closing: !isPinnedRow && hovering?.panel === panel && hovering.closing,
              target,
            }}
          />
        </Box>
      )
    }

    const shown = PANELS.filter(p => lines.flat(2).some(s => s.menu === p))
    const panelArea = rowOrder(slotOrder, pinnedList, hovering?.panel ?? null, shown)
      .map(panelBlock)
      .filter(block => block !== null)
    const rule = (key: string) => (
      <Box key={key} width="100%" overflow="hidden">
        <Text color={look.colors.rules} wrap="truncate">
          {'─'.repeat(Math.max(1, e.props.bodyColumns))}
        </Text>
      </Box>
    )
    const sep: Seg = { text: ' | ', color: look.colors.icons }

    const bandLines = lines.map((line, index) => {
      const segs: Seg[] = []
      line.forEach((part, i) => {
        if (i > 0) segs.push(sep)
        segs.push(...part)
      })
      const runs: Seg[][] = []
      for (const s of segs) {
        const last = runs[runs.length - 1]
        const head = last?.[0]
        const joins = s.menu ? head?.menu === s.menu : !head?.menu
        if (last && joins) last.push(s)
        else runs.push([s])
      }
      return (
        <Box key={`line${index}`} flexDirection="row" flexWrap="wrap">
          {runs.map(run => {
            const first = run[0]
            if (!first) return null
            const panel = PANELS.find(p => p === first.menu)
            if (panel === 'harness' && !harnessList) return <Text color={first.color}>{first.text}</Text>
            if (panel) {
              return (
                <Client
                  key={`${panel}-chip`}
                  module="./chip.tsx"
                  props={{
                    text: run.map(s => s.text).join(''),
                    color: first.color,
                    isActive: isPinned(panel),
                    ...(run.length > 1 ? { parts: run.map(s => ({ text: s.text, color: s.color })) } : {}),
                  }}
                />
              )
            }
            if (first.menu === 'project') {
              return (
                <Client
                  key="project-chip"
                  module="./chip.tsx"
                  props={{ text: first.text, color: first.color, look: 'link' }}
                />
              )
            }
            return run.map(s => <Text color={s.color}>{s.text}</Text>)
          })}
        </Box>
      )
    })
    const rows = panelArea.length > 0 ? [rule('rule-top'), ...panelArea, rule('rule-bottom')] : []
    // The desktop app grows the band downward, so rows opened above the lines would push the
    // hovered name away from the pointer; there they open below the lines instead.
    return e.surface === 'desktop' ? (
      <Box flexDirection="column">
        {bandLines}
        {rows}
      </Box>
    ) : (
      <Box flexDirection="column">
        {rows.length ? rows : <Text key="top-gap"> </Text>}
        {bandLines}
      </Box>
    )
  })
}
