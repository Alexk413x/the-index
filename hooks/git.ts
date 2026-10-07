import type { IndexCommit, IndexGit, IndexMergedPr, IndexPullRequest, IndexRateLimit } from '../types'
import { repoWebFromRemote } from './format'

export const BASE_REFS = [
  'refs/remotes/origin/HEAD',
  'refs/remotes/origin/main',
  'refs/remotes/origin/master',
  'refs/heads/main',
  'refs/heads/master',
] as const

export function numstatTotals(text: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of text.split('\n')) {
    const cols = row.split('\t')
    if (cols.length >= 3 && !row.startsWith(':')) {
      added += parseInt(cols[0] ?? '', 10) || 0
      removed += parseInt(cols[1] ?? '', 10) || 0
    }
  }
  return { added, removed }
}

export function parsePullRequests(data: unknown): IndexPullRequest[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(pr =>
    isRecord(pr) && typeof pr['number'] === 'number' && typeof pr['url'] === 'string'
      ? [
          {
            number: pr['number'],
            title: typeof pr['title'] === 'string' ? pr['title'] : '',
            url: pr['url'],
            branch: typeof pr['headRefName'] === 'string' ? pr['headRefName'] : '',
          },
        ]
      : [],
  )
}

const FIX_SUBJECT = /^\s*(fix|fixes|fixed|bug|bugfix|hotfix|revert)\b/i

export function isFix(subject: string): boolean {
  return FIX_SUBJECT.test(subject)
}

export function parseMergedPrs(data: unknown): IndexMergedPr[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(pr => {
    if (!isRecord(pr) || typeof pr['number'] !== 'number' || typeof pr['url'] !== 'string') return []
    const openedAt = Date.parse(String(pr['createdAt'] ?? ''))
    const mergedAt = Date.parse(String(pr['mergedAt'] ?? ''))
    if (!Number.isFinite(openedAt) || !Number.isFinite(mergedAt)) return []
    const num = (key: string) => (typeof pr[key] === 'number' ? (pr[key] as number) : 0)
    return [
      {
        number: pr['number'],
        title: typeof pr['title'] === 'string' ? pr['title'] : '',
        url: pr['url'],
        added: num('additions'),
        removed: num('deletions'),
        files: num('changedFiles'),
        commits: Array.isArray(pr['commits']) ? pr['commits'].length : num('commits'),
        openedAt,
        mergedAt,
      },
    ]
  })
}

export const COMMIT_FORMAT = '@%H%x09%ct%x09%s'

export function parseCommitLog(text: string): IndexCommit[] {
  const commits: IndexCommit[] = []
  for (const row of text.split('\n')) {
    if (row.startsWith('@')) {
      const [sha = '', at = '', ...subject] = row.slice(1).split('\t')
      commits.push({
        sha,
        at: (parseInt(at, 10) || 0) * 1000,
        subject: subject.join('\t'),
        added: 0,
        removed: 0,
        files: 0,
        filesAdded: 0,
        filesDeleted: 0,
      })
      continue
    }
    const current = commits[commits.length - 1]
    if (current && row.startsWith(' create mode ')) {
      current.filesAdded = (current.filesAdded ?? 0) + 1
      continue
    }
    if (current && row.startsWith(' delete mode ')) {
      current.filesDeleted = (current.filesDeleted ?? 0) + 1
      continue
    }
    const cols = row.split('\t')
    if (!current || cols.length < 3) continue
    current.added += parseInt(cols[0] ?? '', 10) || 0
    current.removed += parseInt(cols[1] ?? '', 10) || 0
    current.files += 1
  }
  return commits
}

export function emptyGit(remote: string): IndexGit {
  return {
    branch: '',
    branchPushed: false,
    repoWeb: repoWebFromRemote(remote),
    filesAdded: 0,
    filesModified: 0,
    filesDeleted: 0,
    linesAdded: 0,
    linesRemoved: 0,
    prBaseRef: '',
    prBaseName: '',
    prFilesAdded: 0,
    prFilesModified: 0,
    prFilesDeleted: 0,
    prLinesAdded: 0,
    prLinesRemoved: 0,
    prAhead: 0,
    prBehind: 0,
  }
}

export function applyStatus(snap: IndexGit, status: string): void {
  let oid = ''
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      if (head !== '(detached)') snap.branch = head
    } else if (line.startsWith('# branch.oid ')) {
      oid = line.slice('# branch.oid '.length)
    } else if (line.startsWith('? ')) {
      snap.filesAdded += 1
    } else if (['1 ', '2 ', 'u '].includes(line.slice(0, 2)) && line.length >= 4) {
      const x = line[2]
      const y = line[3]
      if (x === 'A') snap.filesAdded += 1
      else if (x === 'D' || y === 'D') snap.filesDeleted += 1
      else snap.filesModified += 1
    }
  }
  if (!snap.branch && oid && oid !== '(initial)') snap.branch = oid.slice(0, 7)
}

export function applyBase(snap: IndexGit, refsOut: string): void {
  const refs = new Map<string, string>()
  for (const row of refsOut.split('\n')) {
    const [name, target = ''] = row.split('\t')
    if (name) refs.set(name, target)
  }
  const originHead = refs.get('refs/remotes/origin/HEAD') ?? ''
  if (originHead) {
    snap.prBaseRef = originHead.replace('refs/remotes/', '')
    snap.prBaseName = snap.prBaseRef.replace('origin/', '')
  } else {
    for (const cand of ['main', 'master']) {
      if (refs.has(`refs/remotes/origin/${cand}`)) {
        snap.prBaseRef = `origin/${cand}`
        snap.prBaseName = cand
        break
      }
      if (refs.has(`refs/heads/${cand}`)) {
        snap.prBaseRef = cand
        snap.prBaseName = cand
        break
      }
    }
  }
  const onBase = snap.branch === snap.prBaseName
  if (!snap.prBaseRef || (onBase && !snap.prBaseRef.startsWith('origin/'))) snap.prBaseRef = ''
}

export function applyPr(snap: IndexGit, raw: string, leftRight: string): void {
  const lines = numstatTotals(raw)
  snap.prLinesAdded = lines.added
  snap.prLinesRemoved = lines.removed
  for (const row of raw.split('\n')) {
    if (!row.startsWith(':')) continue
    const meta = (row.split('\t')[0] ?? '').split(/\s+/)
    const st = meta[meta.length - 1] ?? ''
    if (st.startsWith('A')) snap.prFilesAdded += 1
    else if (st.startsWith('D')) snap.prFilesDeleted += 1
    else if (st) snap.prFilesModified += 1
  }
  const parts = leftRight.split(/\s+/)
  if (parts.length >= 2) {
    snap.prBehind = parseInt(parts[0] ?? '', 10) || 0
    snap.prAhead = parseInt(parts[1] ?? '', 10) || 0
  }
}

export type WorktreeEntry = { path: string; branch: string }

export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const block of porcelain.split(/\r?\n\s*\r?\n/)) {
    let path = ''
    let branch = ''
    let skip = false
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim().replace(/\\/g, '/')
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      else if (line === 'bare' || line.startsWith('prunable')) skip = true
    }
    if (path && !skip) entries.push({ path, branch })
  }
  return entries
}

export function worktreeName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[a-z]:/i.test(slashed) ? slashed.toLowerCase() : slashed
  }
  return norm(a) === norm(b)
}

export function worktreeGitDir(path: string, dotGit: string | null): string {
  const m = dotGit ? /^gitdir:\s*(.+)$/m.exec(dotGit) : null
  const target = m?.[1]?.trim().replace(/\\/g, '/')
  if (!target) return `${path}/.git`
  return /^([a-z]:)?\//i.test(target) ? target : `${path}/${target}`
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export type SharedLimits = { fiveHour: IndexRateLimit | null; sevenDay: IndexRateLimit | null }

export function parseSharedLimits(raw: unknown): SharedLimits {
  const pick = (key: string): IndexRateLimit | null => {
    const w = isRecord(raw) ? raw[key] : undefined
    if (!isRecord(w) || w['used_percentage'] === undefined || w['used_percentage'] === null) return null
    return {
      usedPercentage: Number(w['used_percentage']) || 0,
      resetsAt: (Number(w['resets_at']) || 0) * 1000,
    }
  }
  return { fiveHour: pick('five_hour'), sevenDay: pick('seven_day') }
}

export function serializeSharedLimits(limits: SharedLimits): string {
  const out: Record<string, { used_percentage: number; resets_at: number }> = {}
  const put = (key: string, rl: IndexRateLimit | null) => {
    if (rl) out[key] = { used_percentage: rl.usedPercentage, resets_at: Math.round(rl.resetsAt / 1000) }
  }
  put('five_hour', limits.fiveHour)
  put('seven_day', limits.sevenDay)
  return JSON.stringify(out)
}
