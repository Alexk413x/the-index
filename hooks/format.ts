import type { PluginOptions } from 'claude-code'

import type {
  IndexAgentStep,
  IndexCall,
  IndexEffort,
  IndexGit,
  IndexHost,
  IndexRateLimit,
  IndexTotals,
  IndexUsage,
} from '../types'

export const MAIN = 'main'

export const MODEL_CHOICES = [
  { alias: 'fable', id: 'claude-fable-5-1' },
  { alias: 'opus', id: 'claude-opus-5-5' },
  { alias: 'sonnet', id: 'claude-sonnet-5-5' },
  { alias: 'haiku', id: 'claude-haiku-4-5-20251001' },
] as const

export const SHADE = '░'
const SYM_IN = '↑'
const SYM_OUT = '↓'
const SYM_CC = '⤒'
const SYM_CR = '⤓'
const SYM_TPS = '↯'
const SYM_CALL = 'Δ'
const SYM_TOT = 'Σ'
const SYM_5H = ['◷', '◶', '◵', '◴'] as const
const FIVE_HOURS_MS = 5 * 3_600_000
const SYM_7D = '⧈'
const SYM_CTX = ['○', '◔', '◑', '◕', '●'] as const
const NERD_CTX_EMPTY = 0xf0766
const NERD_CTX_SLICE_1 = 0xf0a9e
const SYM_BR = '⎇'
const SYM_LINES = '≡'
const SYM_HIT = '⌖'
const SYM_FILES = '◻'
// VS Code and other terminals draw U+23F1 two cells wide while the layout counts
// one; the trailing space gives it the second cell so the value isn't drawn over it.
const SYM_AT = '⏱ '
const SYM_AHEAD = '↑'
const SYM_BEHIND = '↓'
const SYM_BOOM = '💥'
const SYM_CACHE = ['☀', '☼', '❅'] as const
const SYM_COLD = '❄'
const SYM_FOLDER = '□'
const SYM_REMOTE_ON = '●'
const SYM_REMOTE_OFF = '○'
const SYM_AGENT = '⤷'

export const SEGMENTS = [
  'remote',
  'session',
  'model',
  'ide',
  'cache',
  'context',
  'uptime',
  'rate_limits',
  'calls',
  'totals',
  'project',
  'commit_diff',
  'pr_diff',
  'agent_view',
] as const

export type Segment = (typeof SEGMENTS)[number]

export const COLOR_DEFAULTS = {
  session: '#d75f00',
  model: '#d75f00',
  ide: '#d75f00',
  uptime: '#d75f00',
  resets: '#d75f00',
  calls: '#d75f00',
  totals: '#d75f00',
  project: '#d75f00',
  branch: '#d75f00',
  icons: '#808080',
  good: '#008700',
  warn: '#d7d700',
  high: '#d75f00',
  bad: '#c80000',
  cold: '#00afd7',
  rules: '#000000',
} as const

export type ColorName = keyof typeof COLOR_DEFAULTS

export type Config = {
  dim: number
  cacheTtlMs: number
  glyphs: 'unicode' | 'nerd'
  show: Readonly<Record<Segment, boolean>>
  colors: Readonly<Record<ColorName, string>>
}

const HEX = /^#?([0-9a-f]{6})$/i

export function dimHex(hex: string, dim: number): string {
  const m = HEX.exec(hex.trim())
  if (!m?.[1]) return hex
  const n = parseInt(m[1], 16)
  const channel = (shift: number) =>
    Math.round(((n >> shift) & 0xff) * dim)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

export function readConfig(options: PluginOptions): Config {
  const rawDim = Number(options['dim'])
  const dim = Number.isFinite(rawDim) ? Math.min(1, Math.max(0.1, rawDim)) : 0.95
  const show = {} as Record<Segment, boolean>
  for (const s of SEGMENTS) show[s] = options[`show_${s}`] !== false
  const colors = {} as Record<ColorName, string>
  for (const name of Object.keys(COLOR_DEFAULTS) as ColorName[]) {
    const raw = options[`color_${name}`]
    const hex = typeof raw === 'string' && HEX.test(raw.trim()) ? raw.trim() : COLOR_DEFAULTS[name]
    colors[name] = dimHex(hex.startsWith('#') ? hex : `#${hex}`, dim)
  }
  const cacheTtlMs = options['cache_ttl'] === '5m' ? 300_000 : 3_600_000
  const glyphs = options['glyphs'] === 'nerd' ? 'nerd' : 'unicode'
  return { dim, cacheTtlMs, glyphs, show, colors }
}

export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(\[1m\])?$/i.exec(id.trim())
  if (!m?.[1]) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return `${family} ${m[2]}.${m[3]}${m[4] ? ' (1M context)' : ''}`
}

export function effortLabel(effort: IndexEffort | undefined): string {
  return effort === undefined ? '' : String(effort)
}

export function fmtNum(value: number): string {
  const n = Math.trunc(value)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function fmtCost(v: number): string {
  if (v >= 0.01) return v.toFixed(2)
  if (v > 0) return v.toFixed(4)
  return '0.00'
}

export function fmtUntil(resetsAtMs: number, nowMs: number): string {
  const secs = Math.floor((resetsAtMs - nowMs) / 1000)
  if (secs <= 0) return '0m'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m`
  return `${secs}s`
}

export function fmtDur(totalSecs: number): string {
  const secs = Math.max(0, Math.trunc(totalSecs))
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  return fmtDur(Math.round(s))
}

export function hitPct(cacheRead: number, totalIn: number): number {
  if (totalIn <= 0) return 0
  return Math.max(0, Math.min(100, Math.floor((cacheRead / totalIn) * 100)))
}

export function contextGlyph(pct: number, glyphs: Config['glyphs']): string {
  if (glyphs === 'nerd') {
    const slice = Math.round(Math.max(0, Math.min(100, pct)) / 12.5)
    return String.fromCodePoint(slice === 0 ? NERD_CTX_EMPTY : NERD_CTX_SLICE_1 + slice - 1)
  }
  if (pct >= 90) return SYM_CTX[4]
  if (pct >= 60) return SYM_CTX[3]
  if (pct >= 40) return SYM_CTX[2]
  if (pct >= 10) return SYM_CTX[1]
  return SYM_CTX[0]
}

export function cacheGlyph(frac: number): string {
  if (frac <= 0) return SYM_COLD
  if (frac > 0.5) return SYM_CACHE[0]
  if (frac > 0.1) return SYM_CACHE[1]
  return SYM_CACHE[2]
}

export function fiveHourGlyph(rl: IndexRateLimit | null | undefined, nowMs: number): string {
  if (!rl?.resetsAt || rl.resetsAt <= nowMs) return SYM_5H[0]
  const elapsed = FIVE_HOURS_MS - (rl.resetsAt - nowMs)
  const quarter = Math.min(4, Math.max(1, Math.ceil(elapsed / (FIVE_HOURS_MS / 4))))
  return SYM_5H[quarter - 1] ?? SYM_5H[0]
}

export function nextChangeMs(snap: Snapshot, cfg: Config): number {
  const untilStep = (remainingMs: number) => {
    if (remainingMs <= 0) return Infinity
    if (remainingMs <= 60_000) return (remainingMs % 1000) + 1
    return (remainingMs % 60_000) + 1
  }
  const candidates = [60_000]
  const last = snap.totals.lastResponseAt
  if (cfg.show.cache && last !== null) candidates.push(untilStep(last + (snap.totals.cacheTtlMs ?? cfg.cacheTtlMs) - snap.now))
  if (cfg.show.rate_limits) {
    for (const rl of [snap.usage?.fiveHour, snap.usage?.sevenDay]) {
      if (rl?.resetsAt) candidates.push(untilStep(rl.resetsAt - snap.now))
    }
  }
  return Math.max(1000, Math.min(...candidates))
}

export type Menu = 'harness' | 'effort' | 'model' | 'session' | 'project'
export type Seg = { text: string; color: string; href?: string; menu?: Menu }
export type Part = readonly Seg[]
export type Line = readonly Part[]

export type Snapshot = {
  now: number
  agents: Readonly<Record<string, IndexAgentStep>>
  call: IndexCall | null
  totals: IndexTotals
  usage: IndexUsage | null
  git: IndexGit | null
  host: IndexHost | null
  clients: number
  agentEfforts: Readonly<Record<string, IndexEffort>>
  agentModels: Readonly<Record<string, string>>
}

export type ViewedAgent = {
  id: string
  type: string
  status: string
  label: string
}

export function buildLines(snap: Snapshot, cfg: Config, viewed?: ViewedAgent): Line[] {
  const c = cfg.colors
  const seg = (text: string, color: string, href?: string): Seg =>
    href ? { text, color, href } : { text, color }
  const icon = (text: string) => seg(text, c.icons)
  const sp = seg(' ', c.icons)

  const ctxColor = (pct: number) => (pct > 80 ? c.bad : pct > 60 ? c.high : pct > 40 ? c.warn : c.good)
  const hitColor = (pct: number) => (pct >= 70 ? c.good : pct >= 40 ? c.warn : c.bad)

  const line1: Part[] = []
  const host = snap.host

  const name: Seg[] = []
  if (cfg.show.remote && host?.bridged) {
    name.push(snap.clients > 0 ? seg(SYM_REMOTE_ON, c.good) : seg(SYM_REMOTE_OFF, c.icons))
  }
  if (cfg.show.session && host?.sessionName) {
    if (name.length) name.push(sp)
    name.push({ text: host.sessionName, color: c.session, menu: 'session' })
  }
  if (name.length) line1.push(name)

  if (viewed && cfg.show.agent_view) {
    const step = snap.agents[viewed.id]
    const statusColor =
      viewed.status === 'running' ? c.good : viewed.status === 'completed' ? c.icons : c.bad
    const head: Seg[] = [icon(SYM_AGENT), sp, seg(viewed.type, c.model)]
    if (viewed.label) head.push(sp, seg(viewed.label, c.icons))
    const agentModel = snap.agentModels[viewed.id] ?? step?.model
    head.push(sp, { text: agentModel ? modelLabel(agentModel) : SHADE.repeat(2), color: c.model, menu: 'model' })
    const effort = effortLabel(snap.agentEfforts[viewed.id] ?? step?.effort)
    head.push(sp, { text: effort || SHADE.repeat(2), color: c.model, menu: 'effort' })
    head.push(sp, seg(viewed.status, statusColor))
    line1.push(head)
  } else if (cfg.show.model) {
    const main = snap.agents[MAIN]
    const model = main?.model ? modelLabel(main.model) : 'Unknown'
    const effort = effortLabel(main?.effort)
    const head: Seg[] = []
    if (host?.agentName) head.push({ text: host.agentName, color: c.model, menu: 'harness' }, sp)
    head.push({ text: model, color: c.model, menu: 'model' })
    head.push(sp, { text: effort || SHADE.repeat(2), color: c.model, menu: 'effort' })
    line1.push(head)
  }

  if (cfg.show.ide && host?.ide) line1.push([seg(host.ide, c.ide)])

  const gauges: Seg[][] = []
  if (cfg.show.cache) {
    const last = snap.totals.lastResponseAt
    if (last === null) {
      gauges.push([icon(SYM_CACHE[0]), sp, seg(`${SHADE.repeat(2)}m`, c.good)])
    } else {
      const ttlMs = snap.totals.cacheTtlMs ?? cfg.cacheTtlMs
      const left = Math.floor((last + ttlMs - snap.now) / 1000)
      if (left > 0) {
        const frac = left / (ttlMs / 1000)
        const col = frac > 0.5 ? c.good : frac > 0.25 ? c.warn : frac > 0.1 ? c.high : c.bad
        const txt =
          left >= 60 ? `${String(Math.floor(left / 60)).padStart(2, '0')}m` : `${String(left).padStart(2, '0')}s`
        gauges.push([icon(cacheGlyph(frac)), sp, seg(txt, col)])
      } else {
        gauges.push([icon(SYM_COLD), sp, seg('00m', c.cold)])
      }
    }
  }

  const usage = snap.usage
  const ctx: Seg[] = []
  if (cfg.show.context) {
    const known = usage?.contextPercent !== null && usage?.contextPercent !== undefined
    const pct = known ? Math.trunc(usage.contextPercent as number) : 0
    const glyph = contextGlyph(pct, cfg.glyphs)
    const compactions = usage?.compactions ?? 0
    if (compactions > 0) {
      if (compactions <= 3) ctx.push(seg(SYM_BOOM.repeat(compactions), c.high))
      else ctx.push(seg(SYM_BOOM, c.high), seg(`x${compactions}`, c.high))
      ctx.push(sp)
    }
    ctx.push(icon(glyph), sp, seg(known ? `${pct}%` : `${SHADE.repeat(2)}%`, ctxColor(pct)))
  }
  if (cfg.show.uptime && usage) {
    if (ctx.length) ctx.push(sp)
    ctx.push(seg(fmtDur((snap.now - usage.startedAt) / 1000), c.uptime))
  }
  if (ctx.length) gauges.push(ctx)

  if (cfg.show.rate_limits) {
    const windows: [IndexRateLimit | null | undefined, string, string][] = [
      [usage?.fiveHour, fiveHourGlyph(usage?.fiveHour, snap.now), `${SHADE}h${SHADE.repeat(2)}m`],
      [usage?.sevenDay, SYM_7D, `${SHADE}d${SHADE.repeat(2)}h`],
    ]
    for (const [rl, sym, blank] of windows) {
      if (rl && !(rl.resetsAt && rl.resetsAt <= snap.now)) {
        const p = Math.trunc(rl.usedPercentage)
        const bits: Seg[] = [icon(sym), sp, seg(`${p}%`, ctxColor(p))]
        if (rl.resetsAt) bits.push(sp, seg(fmtUntil(rl.resetsAt, snap.now), c.resets))
        gauges.push(bits)
      } else {
        gauges.push([icon(sym), sp, seg(`${SHADE.repeat(2)}%`, c.good), sp, seg(blank, c.resets)])
      }
    }
  }
  if (gauges.length) line1.push(joinWith(gauges, sp))

  const line2: Part[] = []
  const t = snap.totals
  const noData = t.requests === 0
  if (cfg.show.calls) {
    const v = c.calls
    const call = snap.call
    let bits: Seg[][]
    if (noData || !call) {
      bits = [
        [icon(SYM_IN), seg(SHADE.repeat(2), v)],
        [icon(SYM_CC), seg(SHADE.repeat(4), v)],
        [icon(SYM_CR), seg(SHADE.repeat(4), v)],
        [icon(SYM_OUT), seg(SHADE.repeat(4), v)],
        [icon(SYM_TPS), seg(SHADE.repeat(2), v)],
        [icon(SYM_HIT), seg(`${SHADE.repeat(2)}%`, c.good)],
        [icon(SYM_LINES), seg(`+${SHADE.repeat(2)}`, c.good), sp, seg(`-${SHADE.repeat(2)}`, c.bad)],
        [icon(SYM_AT), seg(`${SHADE.repeat(2)}s`, v)],
        [icon('$'), seg(`${SHADE}.${SHADE.repeat(2)}`, v)],
      ]
    } else {
      const totalIn = call.input + call.cacheWrite + call.cacheRead
      const hit = hitPct(call.cacheRead, totalIn)
      bits = [
        [icon(SYM_IN), seg(fmtNum(call.input), v)],
        [icon(SYM_CC), seg(fmtNum(call.cacheWrite), v)],
        [icon(SYM_CR), seg(fmtNum(call.cacheRead), v)],
        [icon(SYM_OUT), seg(fmtNum(call.output), v)],
      ]
      if (call.output > 0 && call.apiMs > 0) {
        bits.push([icon(SYM_TPS), seg((call.output / (call.apiMs / 1000)).toFixed(0), v)])
      }
      bits.push(
        [icon(SYM_HIT), seg(`${hit}%`, hitColor(hit))],
        [icon(SYM_LINES), seg(`+${call.linesAdded}`, c.good), sp, seg(`-${call.linesRemoved}`, c.bad)],
        [icon(SYM_AT), seg(fmtMs(call.apiMs), v)],
        [icon('$'), seg(call.costUsd === null ? `${SHADE}.${SHADE.repeat(2)}` : fmtCost(call.costUsd), v)],
      )
    }
    line2.push([icon(SYM_CALL), sp, ...joinWith(bits, sp)])
  }
  if (cfg.show.totals) {
    const v = c.totals
    let bits: Seg[][]
    if (noData) {
      bits = [
        [icon(SYM_CC), seg(SHADE.repeat(5), v)],
        [icon(SYM_HIT), seg(`${SHADE.repeat(2)}%`, c.good)],
        [seg(`${SHADE.repeat(2)}%`, c.good)],
        [icon(SYM_LINES), seg(`+${SHADE.repeat(3)}`, c.good), sp, seg(`-${SHADE.repeat(3)}`, c.bad)],
        [icon(SYM_AT), seg(`${SHADE.repeat(2)}m${SHADE.repeat(2)}s`, v)],
        [icon('$'), seg(`${SHADE}.${SHADE.repeat(2)}`, v)],
      ]
    } else {
      const over = hitPct(t.cacheRead, t.input + t.cacheWrite + t.cacheRead)
      const recent =
        t.ewmaHit === null ? over : Math.max(0, Math.min(100, Math.floor(t.ewmaHit * 100)))
      const few = t.requests < 3
      const cost = usage?.costUsd
      bits = [
        [icon(SYM_CC), seg(fmtNum(t.cacheWrite), v)],
        [icon(SYM_HIT), seg(`${over}%`, few ? c.icons : hitColor(over))],
        [seg(`${recent}%`, few ? c.icons : hitColor(recent))],
        [icon(SYM_LINES), seg(`+${t.linesAdded}`, c.good), sp, seg(`-${t.linesRemoved}`, c.bad)],
        [icon(SYM_AT), seg(fmtMs(t.apiMs), v)],
        [icon('$'), seg(cost === null || cost === undefined ? `${SHADE}.${SHADE.repeat(2)}` : fmtCost(cost), v)],
      ]
    }
    line2.push([icon(SYM_TOT), sp, ...joinWith(bits, sp)])
  }

  const line3: Part[] = []
  if (cfg.show.project && host?.project) {
    line3.push([icon(SYM_FOLDER), sp, { text: host.project, color: c.project, menu: 'project' }])
  }
  const git = snap.git
  if (git?.branch) {
    const branchUrl = encodeURIComponent(git.branch)
    const treeUrl = git.repoWeb && git.branchPushed ? `${git.repoWeb}/tree/${branchUrl}` : undefined
    if (cfg.show.commit_diff) {
      line3.push([
        icon(SYM_BR),
        sp,
        seg(git.branch, c.branch, treeUrl),
        sp,
        icon(SYM_FILES),
        sp,
        seg(String(git.filesAdded), c.good),
        sp,
        seg(String(git.filesModified), c.warn),
        sp,
        seg(String(git.filesDeleted), c.bad),
        sp,
        icon(SYM_LINES),
        sp,
        seg(`+${git.linesAdded}`, c.good),
        sp,
        seg(`-${git.linesRemoved}`, c.bad),
      ])
    }
    if (cfg.show.pr_diff && git.prBaseRef) {
      const onBase = git.branch === git.prBaseName
      const label = git.prBaseRef
      const compareUrl =
        !onBase && git.repoWeb && git.branchPushed
          ? `${git.repoWeb}/compare/${encodeURIComponent(git.prBaseName)}...${branchUrl}?expand=1`
          : undefined
      const historyUrl = onBase && git.repoWeb ? `${git.repoWeb}/commits/${branchUrl}` : undefined
      const prUrl = git.prLink ?? compareUrl ?? historyUrl
      line3.push([
        icon(SYM_AHEAD),
        seg(String(git.prAhead), c.good),
        sp,
        icon(SYM_BEHIND),
        seg(String(git.prBehind), c.bad),
        sp,
        icon(SYM_BR),
        sp,
        seg(git.prNumber ? `#${git.prNumber} ${label}` : label, c.branch, prUrl),
        sp,
        icon(SYM_FILES),
        sp,
        seg(String(git.prFilesAdded), c.good),
        sp,
        seg(String(git.prFilesModified), c.warn),
        sp,
        seg(String(git.prFilesDeleted), c.bad),
        sp,
        icon(SYM_LINES),
        sp,
        seg(`+${git.prLinesAdded}`, c.good),
        sp,
        seg(`-${git.prLinesRemoved}`, c.bad),
      ])
    }
  }

  return [line1, line2, line3].filter(l => l.length > 0)
}

function joinWith(groups: readonly Seg[][], sep: Seg): Seg[] {
  const out: Seg[] = []
  groups.forEach((g, i) => {
    if (i > 0) out.push(sep)
    out.push(...g)
  })
  return out
}

export function lineText(line: Line): string {
  return line.map(part => part.map(s => s.text).join('')).join(' | ')
}

export function projectName(cwd: string): string {
  const segs = cwd.split(/[\\/]+/).filter(Boolean)
  return segs[segs.length - 1] ?? ''
}

export function repoWebFromRemote(remote: string): string {
  const r = remote.trim().replace(/\.git$/, '')
  const scp = /^git@([^:]+):(.+)$/.exec(r)
  if (scp) return `https://${scp[1]}/${scp[2]}`
  const ssh = /^ssh:\/\/git@([^/]+)\/(.+)$/.exec(r)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`
  if (/^https?:\/\//.test(r)) return r.replace(/^http:\/\//, 'https://')
  return ''
}

export function normPath(p: string): string {
  let q = p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
  const m = /^\/mnt\/([a-z])(\/.*)?$/.exec(q)
  if (m) q = `${m[1]}:${m[2] ?? ''}`
  return q
}

export function patchLineCounts(
  patch: readonly { lines: readonly string[] }[] | undefined,
): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of patch ?? []) {
    for (const l of hunk.lines) {
      if (l.startsWith('+')) added += 1
      else if (l.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}

export const EMPTY_TOTALS: IndexTotals = {
  requests: 0,
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  apiMs: 0,
  ewmaHit: null,
  linesAdded: 0,
  linesRemoved: 0,
  lastResponseAt: null,
  markAdded: 0,
  markRemoved: 0,
  markCostUsd: null,
}

export function mergeRateLimit(
  candidates: readonly (IndexRateLimit | null | undefined)[],
): IndexRateLimit | null {
  let best: IndexRateLimit | null = null
  for (const c of candidates) {
    if (!c) continue
    if (best === null) {
      best = c
      continue
    }
    const jitter = 300_000
    if (c.resetsAt > best.resetsAt + jitter) best = c
    else if (Math.abs(c.resetsAt - best.resetsAt) <= jitter && c.usedPercentage > best.usedPercentage) best = c
  }
  return best
}
