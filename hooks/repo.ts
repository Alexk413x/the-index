import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { IndexGit, IndexMergedPr, IndexPullRequest } from '../types'
import {
  BASE_REFS,
  COMMIT_FORMAT,
  GIT_SAFE_ENV,
  applyBase,
  applyPr,
  applyStatus,
  assembleRepos,
  belongsToRepo,
  emptyGit,
  gitArgv,
  isRecord,
  numstatTotals,
  parseCommitLog,
  parseJson,
  parseMergedPrs,
  parsePullRequests,
  parseWorktrees,
  readRepo,
  samePath,
  worktreeGitDir,
  worktreeName,
  type GitFs,
} from './lib/git'
import { runSerial, same, serial } from './lib/serial'

// The validator reads an atom only in the file that declares it, so each file declares the atoms it uses.
const git = atom({ plugin: 'the-index', key: 'git' } as const, null)
const baseCommits = atom({ plugin: 'the-index', key: 'baseCommits' } as const, [])
const branchCommits = atom({ plugin: 'the-index', key: 'branchCommits' } as const, [])
const mergedPrs = atom({ plugin: 'the-index', key: 'mergedPrs' } as const, [])
const basePrs = atom({ plugin: 'the-index', key: 'basePrs' } as const, [])
const worktrees = atom({ plugin: 'the-index', key: 'worktrees' } as const, [])
const deviceRepos = atom({ plugin: 'the-index', key: 'deviceRepos' } as const, [])

const BRANCH_COMMIT_LIMIT = 20
const MERGED_PR_LIMIT = 10
const BASE_PR_LIMIT = 10
const GIT_DEBOUNCE_MS = 1000
const PR_CACHE_MS = 300_000
const NO_PR_CACHE_MS = 60_000
const prCache = new Map<string, { at: number; pr: { number: number; url: string } | null }>()
const GIT_STAMP_FILES = ['index', 'HEAD', 'logs/HEAD', 'FETCH_HEAD', 'ORIG_HEAD']

let gitTimer: Timer | undefined
let gitDir = ''
let gitCwd = ''
const gitRuns = serial()
let lastStamps = new Map<string, string>()
let worktreeTimer: Timer | undefined
let commonDir = ''
let worktreeDirs: string[] = []
let lastWorktreeStamp = ''
let lastListStamp = ''
const worktreeRuns = serial()
const deviceRuns = serial()

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
  const [raw, leftRight, pushed] = await Promise.all([
    runGit($, cwd, ['diff', '--no-ext-diff', '--no-textconv', '--raw', '--numstat', `${snap.prBaseRef}...HEAD`]),
    runGit($, cwd, ['rev-list', '--left-right', '--count', `${snap.prBaseRef}...HEAD`]),
    runGit($, cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${snap.branch}`]),
  ])
  applyPr(snap, raw, leftRight)
  snap.branchPushed = pushed !== ''
  return snap
}

async function withPr($: EngineInterface, cwd: string, snap: IndexGit | null): Promise<IndexGit | null> {
  if (!snap?.branchPushed || snap.branch === snap.prBaseName || !snap.repoWeb.includes('github')) return snap
  const pr = await openPr($, cwd, snap.branch)
  return pr ? { ...snap, prNumber: pr.number, prLink: pr.url } : snap
}

export function forgetPrs(): void {
  prCache.clear()
  basePrCache.clear()
  mergedPrCache.clear()
}

async function openPr($: EngineInterface, cwd: string, branch: string): Promise<{ number: number; url: string } | null> {
  const now = await $.clock.now()
  const cached = prCache.get(branch)
  if (cached && now - cached.at < (cached.pr ? PR_CACHE_MS : NO_PR_CACHE_MS)) return cached.pr
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

export async function resolveGitDirs($: EngineInterface, cwd: string): Promise<void> {
  const [dir, common] = await Promise.all([
    runGit($, cwd, ['rev-parse', '--absolute-git-dir']),
    runGit($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  const moved = gitCwd !== '' && common.replace(/\\/g, '/') !== commonDir
  gitCwd = cwd
  gitDir = dir.replace(/\\/g, '/')
  commonDir = common.replace(/\\/g, '/')
  if (moved) {
    refreshWorktreesSoon($)
    void refreshDevice($)
  }
}

export async function refreshGit($: EngineInterface): Promise<void> {
  await runSerial(gitRuns, () => refreshGitOnce($))
}

async function refreshGitOnce($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  if (cwd !== gitCwd) await resolveGitDirs($, cwd)
  const prev = await read($, git)
  lastStamps = await statStamps($, gitStampPaths(prev))
  const local = await gitSnapshot($, cwd)
  const kept = local && prev?.branch === local.branch && prev.prNumber !== undefined ? { ...local, prNumber: prev.prNumber, prLink: prev.prLink } : local
  if (!same(await read($, git), kept)) await update($, git, () => kept)
  const snap = await withPr($, cwd, local)
  if (!same(await read($, git), snap)) await update($, git, () => snap)
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
  const branchList = parseCommitLog(branchLog)
  const baseList = parseCommitLog(baseLog)
  if (!same(await read($, branchCommits), branchList)) await update($, branchCommits, () => branchList)
  if (!same(await read($, basePrs), prs)) await update($, basePrs, () => prs)
  if (!same(await read($, mergedPrs), merged)) await update($, mergedPrs, () => merged)
  if (!same(await read($, baseCommits), baseList)) await update($, baseCommits, () => baseList)
}

function refStampPaths(snap: IndexGit | null): string[] {
  if (!commonDir) return []
  const refs = [`${commonDir}/packed-refs`]
  if (snap?.branch) refs.push(`${commonDir}/refs/remotes/origin/${snap.branch}`)
  if (snap?.prBaseRef.startsWith('refs/')) refs.push(`${commonDir}/${snap.prBaseRef}`)
  return refs
}

function gitStampPaths(snap: IndexGit | null): string[] {
  if (!gitDir) return []
  return [...GIT_STAMP_FILES.map(f => `${gitDir}/${f}`), ...refStampPaths(snap)]
}

async function statStamps($: EngineInterface, paths: readonly string[]): Promise<Map<string, string>> {
  const stamps = await Promise.all(
    paths.map(path =>
      $.fs.stat(path).then(
        st => String(st.mtimeMs),
        () => '-',
      ),
    ),
  )
  return new Map(paths.map((path, i) => [path, stamps[i] ?? '-']))
}

// A path first watched after a branch change is recorded, not treated as a change.
async function pollGit($: EngineInterface): Promise<void> {
  const [cwd, repo] = await Promise.all([$.session.cwd(), read($, git)])
  if (cwd !== gitCwd) return refreshGitSoon($)
  let changed = false
  for (const [path, stamp] of await statStamps($, gitStampPaths(repo))) {
    const seen = lastStamps.get(path)
    if (seen === undefined) lastStamps.set(path, stamp)
    else if (seen !== stamp) changed = true
  }
  if (changed) refreshGitSoon($)
}

export async function refreshWorktrees($: EngineInterface): Promise<void> {
  await runSerial(worktreeRuns, () => refreshWorktreesOnce($))
}

async function refreshWorktreesOnce($: EngineInterface): Promise<void> {
  lastWorktreeStamp = await worktreeStamp($)
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
  const snaps = new Map(await Promise.all(others.map(async t => [t.path, await withPr($, t.path, await gitSnapshot($, t.path))] as const)))
  const shown = trees.length > 1 ? trees.map(t => ({ path: t.path, name: worktreeName(t.path), current: t.current, git: snaps.get(t.path) ?? null })) : []
  if (!same(await read($, worktrees), shown)) await update($, worktrees, () => shown)
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

export function refreshWorktreesSoon($: EngineInterface): void {
  worktreeTimer?.cancel()
  worktreeTimer = $.clock.after(GIT_DEBOUNCE_MS, () => {
    void refreshWorktrees($)
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

export async function refreshDevice($: EngineInterface): Promise<void> {
  await runSerial(deviceRuns, () => refreshDeviceOnce($))
}

async function refreshDeviceOnce($: EngineInterface): Promise<void> {
  const reads = commonDir ? [await readRepo(gitFs($), commonDir)] : []
  const repos = assembleRepos(reads, commonDir)
  if (!same(await read($, deviceRepos), repos)) await update($, deviceRepos, () => repos)
}

async function worktreeListStamp($: EngineInterface): Promise<string> {
  if (!commonDir) return ''
  return $.fs.stat(`${commonDir}/worktrees`).then(
    st => String(st.mtimeMs),
    () => '-',
  )
}

async function gitStamp($: EngineInterface, dir: string): Promise<string> {
  if (!dir) return ''
  const stamps = await Promise.all(
    GIT_STAMP_FILES.map(f =>
      $.fs.stat(`${dir}/${f}`).then(
        st => String(st.mtimeMs),
        () => '-',
      ),
    ),
  )
  return stamps.join(',')
}

export function refreshGitSoon($: EngineInterface): void {
  gitTimer?.cancel()
  gitTimer = $.clock.after(GIT_DEBOUNCE_MS, () => {
    void refreshGit($)
  })
}

export async function stampRepo($: EngineInterface): Promise<void> {
  lastWorktreeStamp = await worktreeStamp($)
  lastListStamp = await worktreeListStamp($)
  void refreshDevice($)
}

export function pollRepo($: EngineInterface): void {
  void pollGit($)
  void worktreeStamp($).then(stamp => {
    if (stamp !== lastWorktreeStamp) refreshWorktreesSoon($)
  })
  void worktreeListStamp($).then(stamp => {
    if (stamp === lastListStamp) return
    lastListStamp = stamp
    void refreshDevice($)
  })
}
