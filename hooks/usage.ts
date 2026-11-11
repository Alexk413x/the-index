import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer, SessionContextBreakdown, SessionContextUsage, SessionCost, SessionRateLimit, SessionUsage, TurnStepInput, TurnStepResult } from 'claude-code'

import type { IndexContextPoint, IndexDayTotal, IndexNamedLimit, IndexRateLimit, IndexTurnRecord, IndexUsage } from '../types'
import { EMPTY_TOTALS, createdLines, mergeRateLimit, modelWindowLabel, nextChangeMs, patchLineCounts, type Config } from './lib/format'
import { USAGE_DAYS } from './lib/panels'
import { accountModelLimits, isRecord, parseAccountCache, parseAccountUsage, parseJson, parseSharedLimits, serializeSharedLimits } from './lib/git'
import { MAIN_AGENT, dayKey, summarize, type LedgerEntry, partKey, modelKey } from './lib/ledger'
import { KEEP_MONTHS, SHARE_DIR, TOTALS_DIR, isMonth, ledgerOf, monthKey, monthTotal, monthsBack, parseMonthTotal, parseSessionFile, previousMonth, serializeMonthTotal, serializeSessionFile, sessionFileName, splitByMonth, sessionLogOf, usageLogOf, type SessionFile } from './lib/share'
import { HISTORY_MS, turnToRecord, turnWeekOf } from './lib/turns'
import { callKind } from './lib/detail'
import { runSerial, same, serial } from './lib/serial'
import { configDir, readJson, removeFolder, tempDir } from './host'
import { refreshContextDetail } from './pane'

// The validator reads an atom only in the file that declares it, so each file declares the atoms it uses.
const turn = atom({ plugin: 'the-index', key: 'turn' } as const, null)
const totals = atom({ plugin: 'the-index', key: 'totals' } as const, EMPTY_TOTALS)
const usage = atom({ plugin: 'the-index', key: 'usage' } as const, null)
const tick = atom({ plugin: 'the-index', key: 'tick' } as const, 0)
const callLog = atom({ plugin: 'the-index', key: 'callLog' } as const, [])
const usageSummary = atom({ plugin: 'the-index', key: 'usageSummary' } as const, null)
const contextLog = atom({ plugin: 'the-index', key: 'contextLog' } as const, [])
const contextLimit = atom({ plugin: 'the-index', key: 'contextLimit' } as const, null)
const detailOpen = atom({ plugin: 'the-index', key: 'detailOpen' } as const, false)
const turnHistory = atom({ plugin: 'the-index', key: 'turnHistory' } as const, [])
const turnWeek = atom({ plugin: 'the-index', key: 'turnWeek' } as const, null)
const host = atom({ plugin: 'the-index', key: 'host' } as const, null)
const accountUsage = atom({ plugin: 'the-index', key: 'accountUsage' } as const, null)
const usageLogs = atom({ plugin: 'the-index', key: 'usageLogs' } as const, [])
const sessionLog = atom({ plugin: 'the-index', key: 'sessionLog' } as const, null)

const EWMA_ALPHA = 0.3
const CONTEXT_LOG_MAX = 500
const ACCOUNT_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const ACCOUNT_USAGE_BETA = 'oauth-2025-04-20'
const ACCOUNT_CACHE = 'the-index/account-limits.json'
const ACCOUNT_FETCH_MS = 300_000
const ACCOUNT_CHECK_MS = 60_000

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

let measuredLimits: IndexNamedLimit[] = []
let accountLimits: IndexNamedLimit[] = []
let accountCheckedAt = 0

function namedLimits(): IndexNamedLimit[] {
  return [...measuredLimits, ...accountLimits.filter(a => !measuredLimits.some(m => m.kind === a.kind))]
}

// The session's usage call carries no per-model weekly window; the account's usage endpoint does.
// The host sets the credential header from the handle, so the token never reaches this module.
// Every session shares one cache file. A session asks the account only when the file is older than
// ACCOUNT_FETCH_MS, and stamps the file before it asks, so sessions that check meanwhile read the file.
export async function refreshAccountLimits($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - accountCheckedAt < ACCOUNT_CHECK_MS) return
  accountCheckedAt = now
  try {
    const path = `${await configDir($)}/${ACCOUNT_CACHE}`
    const saved = await readJson($, path)
    let account = parseAccountCache(saved)
    if (!account || now - account.fetchedAt >= ACCOUNT_FETCH_MS) {
      const grant = await $.session.authorize()
      if (grant?.kind !== 'bearer') return
      await $.fs.write(path, JSON.stringify({ fetchedAt: now, reply: isRecord(saved) ? saved['reply'] : null }))
      const res = await $.http.fetch(ACCOUNT_USAGE_URL, { auth: grant.handle, headers: { 'anthropic-beta': ACCOUNT_USAGE_BETA } })
      if (!res.ok) return
      const reply = parseJson(res.text)
      account = parseAccountUsage(reply, now)
      if (!account) return
      await $.fs.write(path, JSON.stringify({ fetchedAt: now, reply }))
    }
    accountLimits = accountModelLimits(account)
    if (!same(await read($, accountUsage), account)) await update($, accountUsage, () => account)
  } catch {
    return
  }
  const otherLimits = namedLimits()
  const before = await read($, usage)
  if (before && !same(before.otherLimits ?? [], otherLimits)) await update($, usage, prev => (prev ? { ...prev, otherLimits } : prev))
}

// Shares claude-statusline-ratelimits.json with statusline.py: same path and
// seconds-based shape, so the script and the band agree across open sessions.
export async function recordUsage($: EngineInterface, m: Measured): Promise<void> {
  const sharedPath = `${await tempDir($)}/claude-statusline-ratelimits.json`
  const shared = parseSharedLimits(await readJson($, sharedPath))
  const fiveHour = mergeRateLimit([toLimit(m.rateLimits.find(r => r.kind === 'five_hour')), shared.fiveHour])
  const sevenDay = mergeRateLimit([toLimit(m.rateLimits.find(r => r.kind === 'seven_day')), shared.sevenDay])
  measuredLimits = m.rateLimits.flatMap((r): IndexNamedLimit[] => {
    const limit = modelWindowLabel(r.kind) ? toLimit(r) : null
    return limit ? [{ kind: r.kind, ...limit }] : []
  })
  const otherLimits = namedLimits()
  const text = serializeSharedLimits({ fiveHour, sevenDay })
  if ((fiveHour || sevenDay) && text !== serializeSharedLimits(shared)) {
    await $.fs.write(sharedPath, text).catch(() => undefined)
  }

  const pct = m.context.percent ?? null
  const compaction = pct === null ? undefined : pendingCompaction
  if (pct !== null) pendingCompaction = undefined
  const [detailShown, log, now] = await Promise.all([read($, detailOpen), read($, contextLog), $.clock.now()])
  const unchanged = (p: IndexContextPoint | undefined) => p !== undefined && p.percent === pct && p.tokens === (m.context.tokens ?? null) && !compaction
  const wantsParts = pct !== null && !unchanged(log.at(-1))
  const measured = await usageNow($, detailShown || wantsParts)
  const breakdown = measured.context.breakdown
  const fresh = (compactions: number): IndexUsage => ({
    startedAt: measured.startedAt,
    contextPercent: pct,
    contextTokens: m.context.tokens ?? null,
    costUsd: m.cost?.usd ?? null,
    fiveHour,
    sevenDay,
    ...(otherLimits.length ? { otherLimits } : {}),
    compactions,
  })
  const before = await read($, usage)
  if (!same(before, fresh(before?.compactions ?? 0))) await update($, usage, prev => fresh(prev?.compactions ?? 0))
  if ((await read($, contextLimit))?.window !== m.context.window) {
    await update($, contextLimit, prev => (prev?.window === m.context.window ? prev : { window: m.context.window, threshold: prev?.threshold ?? null }))
  }
  if (detailShown && breakdown) await refreshContextDetail($, false, breakdown)
  if (pct === null) return
  const parts = wantsParts && breakdown ? partsOf(breakdown) : undefined
  await update($, contextLog, prev => {
    const last = prev[prev.length - 1]
    if (unchanged(last)) return prev
    const point = {
      at: now,
      percent: pct,
      tokens: m.context.tokens ?? null,
      ...(parts ? { parts } : {}),
      ...(compaction ? { compaction } : {}),
    }
    return [...prev.slice(-(CONTEXT_LOG_MAX - 1)), point]
  })
}

let pendingCompaction: 'manual' | 'auto' | 'plugin' | undefined

async function usageNow($: EngineInterface, withBreakdown: boolean): Promise<SessionUsage> {
  if (withBreakdown) {
    try {
      return await $.session.usage({ breakdown: 'summary' })
    } catch {
      // Without a bound session the breakdown rejects; the reading then carries no categories.
    }
  }
  return $.session.usage()
}

function partsOf(breakdown: SessionContextBreakdown): Record<string, number> {
  const parts: Record<string, number> = {}
  for (const c of breakdown.categories) if (c.kind === 'used') parts[c.name] = c.tokens
  return parts
}

export async function refreshCompactThreshold($: EngineInterface): Promise<void> {
  try {
    const measured = await $.session.usage({ breakdown: 'summary' })
    const breakdown = measured.context.breakdown
    const threshold = breakdown?.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null
    await update($, contextLimit, () => ({ window: measured.context.window, threshold }))
  } catch {
    // Without a bound session the breakdown rejects; the chart then draws no threshold line.
  }
}

export async function recordEdit($: EngineInterface, result: unknown, isMainLoop: boolean, path: string | undefined): Promise<void> {
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
const SHARE_READS_AT_ONCE = 16
let turnsMine: IndexTurnRecord[] = []
let turnsOthers: IndexTurnRecord[] = []
let turnsDirty = false
let mineLoaded = false
let othersStale = true
let shareName = ''
const ledgerMine: Record<string, LedgerEntry> = {}
let ledgerCost: number | null = null
let ledgerTimer: Timer | undefined
const ledgerRuns = serial()
const agentTypes = new Map<string, string>()
const written = new Map<string, string>()
const shareCache = new Map<string, { mtimeMs: number; size: number; file: SessionFile | null }>()
const closedMonths = new Map<string, readonly IndexDayTotal[]>()
const removedMonths = new Set<string>()

const SESSION_ID = /^[\w-]+$/

export async function openSessionLog($: EngineInterface, target: string): Promise<void> {
  const [month = '', id = ''] = target.split('/')
  if (!isMonth(month) || !SESSION_ID.test(id)) {
    await update($, sessionLog, () => null)
    return
  }
  const file = parseSessionFile(await readJson($, `${await configDir($)}/${SHARE_DIR}/${month}/${sessionFileName(id)}`))
  await update($, sessionLog, () => (file ? sessionLogOf(month, file) : null))
}

export async function syncLedger($: EngineInterface): Promise<void> {
  await runSerial(ledgerRuns, () => syncLedgerOnce($))
}

export async function syncShared($: EngineInterface): Promise<void> {
  othersStale = true
  await syncLedger($)
}

// Each session writes only its own file, one for each month, so sessions never overwrite each other and a resumed session adds to the file it left.
async function syncLedgerOnce($: EngineInterface): Promise<void> {
  const [dir, sessionId, now, hostInfo] = await Promise.all([configDir($), $.session.id(), $.clock.now(), read($, host)])
  const root = `${dir}/${SHARE_DIR}`
  const month = monthKey(now)
  const recent = [previousMonth(month), month]
  if (!mineLoaded) {
    mineLoaded = true
    for (const m of recent) {
      const own = parseSessionFile(await readJson($, `${root}/${m}/${sessionFileName(sessionId)}`))
      if (!own) continue
      shareName ||= own.name
      for (const [date, entry] of Object.entries(own.days)) ledgerMine[date] = resumedEntry(entry, ledgerMine[date])
      const known = new Set(turnsMine.map(t => t.id))
      turnsMine = [...own.turns.filter(t => !known.has(t.id)), ...turnsMine]
    }
  }
  shareName = hostInfo?.sessionName || hostInfo?.project || shareName
  const mineTurns = turnsMine.filter(t => now - t.at <= HISTORY_MS).sort((a, b) => a.at - b.at)
  const mine = splitByMonth(sessionId, shareName, ledgerMine, mineTurns)
  for (const [m, file] of Object.entries(mine)) {
    const text = serializeSessionFile(file)
    if (written.get(m) === text) continue
    await $.fs
      .write(`${root}/${m}/${sessionFileName(sessionId)}`, text)
      .then(() => written.set(m, text))
      .catch(() => undefined)
  }

  if (othersStale || turnsDirty) {
    othersStale = false
    turnsDirty = false
    await readOthers($, root, recent, sessionFileName(sessionId))
  }
  const others = [...shareCache.values()].flatMap(c => (c.file ? [c.file] : []))
  const mineRecent = recent.flatMap(m => (mine[m] ? [mine[m]] : []))
  const summary = summarize(ledgerOf([...others, ...mineRecent]), dayKey(now), USAGE_DAYS, [...closedMonths.values()].flat())
  if (!same(await read($, usageSummary), summary)) await update($, usageSummary, () => summary)
  // Only the open Details pane reads the logs, so a closed pane keeps none in state.
  const logs = (await read($, detailOpen)) ? usageLogOf([...others, ...Object.values(mine)], Object.fromEntries(closedMonths)) : []
  if (!same(await read($, usageLogs), logs)) await update($, usageLogs, () => logs)
  turnsOthers = others.flatMap(f => f.turns).filter(t => now - t.at <= HISTORY_MS)
  await publishTurns($, sessionId, now)
}

// A step recorded before the saved file loaded adds to the saved day, so a resumed session loses neither.
function resumedEntry(saved: LedgerEntry, live: LedgerEntry | undefined): LedgerEntry {
  if (!live) return saved
  const added = (a: Readonly<Record<string, number>> | undefined, b: Readonly<Record<string, number>> | undefined) => {
    const out: Record<string, number> = { ...a }
    for (const [key, tokens] of Object.entries(b ?? {})) out[key] = (out[key] ?? 0) + tokens
    return out
  }
  return {
    tokens: saved.tokens + live.tokens,
    costStart: saved.costStart,
    costEnd: live.costEnd ?? saved.costEnd,
    agents: added(saved.agents, live.agents),
    models: added(saved.models, live.models),
  }
}

async function listDir($: EngineInterface, dir: string) {
  return $.fs.list(dir).catch(() => [])
}

async function readSessionFiles($: EngineInterface, paths: readonly string[]): Promise<(SessionFile | null)[]> {
  const files: (SessionFile | null)[] = []
  for (let at = 0; at < paths.length; at += SHARE_READS_AT_ONCE) {
    files.push(...(await Promise.all(paths.slice(at, at + SHARE_READS_AT_ONCE).map(async path => parseSessionFile(await readJson($, path))))))
  }
  return files
}

// A file is read again only when its size or time changed. A month before the last one has stopped changing, so its day totals are saved once, and its folder is removed after three more months.
async function readOthers($: EngineInterface, root: string, recent: readonly string[], ownFile: string): Promise<void> {
  const listed = new Map<string, { mtimeMs: number; size: number }>()
  for (const m of recent) {
    for (const entry of await listDir($, `${root}/${m}`)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name === ownFile) continue
      listed.set(`${m}/${entry.name}`, { mtimeMs: entry.mtimeMs, size: entry.size })
    }
  }
  for (const key of [...shareCache.keys()]) if (!listed.has(key)) shareCache.delete(key)
  const changed = [...listed].filter(([key, stat]) => {
    const held = shareCache.get(key)
    return !held || held.mtimeMs !== stat.mtimeMs || held.size !== stat.size
  })
  const files = await readSessionFiles($, changed.map(([key]) => `${root}/${key}`))
  changed.forEach(([key, stat], i) => shareCache.set(key, { ...stat, file: files[i] ?? null }))

  const folders = (await listDir($, root)).filter(e => e.kind === 'dir' && isMonth(e.name)).map(e => e.name)
  const totalled = (await listDir($, `${root}/${TOTALS_DIR}`)).map(e => e.name.replace(/\.json$/, '')).filter(isMonth)
  const keepFrom = monthsBack(recent[1] ?? '', KEEP_MONTHS)
  for (const m of new Set([...folders, ...totalled])) {
    if (m >= (recent[0] ?? '')) continue
    const hasFolder = folders.includes(m)
    if (!closedMonths.has(m)) closedMonths.set(m, await closedMonth($, root, m, hasFolder))
    if (hasFolder && m < keepFrom && !removedMonths.has(m)) {
      removedMonths.add(m)
      // The folder goes only once its totals read back from the file that replaces it.
      if (parseMonthTotal(await readJson($, totalPath(root, m)))) await removeFolder($, `${root}/${m}`)
    }
  }
}

function totalPath(root: string, month: string): string {
  return `${root}/${TOTALS_DIR}/${month}.json`
}

async function closedMonth($: EngineInterface, root: string, month: string, hasFolder: boolean): Promise<readonly IndexDayTotal[]> {
  const saved = parseMonthTotal(await readJson($, totalPath(root, month)))
  if (saved || !hasFolder) return saved ?? []
  const dir = `${root}/${month}`
  const names = (await listDir($, dir)).filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => `${dir}/${e.name}`)
  const days = monthTotal((await readSessionFiles($, names)).flatMap(f => (f ? [f] : [])))
  await $.fs.write(totalPath(root, month), serializeMonthTotal(days)).catch(() => undefined)
  return days
}

// State holds only this session's turns and the week's averages: the band reads state on every draw.
async function publishTurns($: EngineInterface, sessionId: string, now: number): Promise<void> {
  const mine = turnsMine.filter(t => now - t.at <= HISTORY_MS).sort((a, b) => a.at - b.at)
  if (!same(await read($, turnHistory), mine)) await update($, turnHistory, () => mine)
  const week = turnWeekOf([...turnsOthers, ...mine], sessionId)
  if (!same(await read($, turnWeek), week)) await update($, turnWeek, () => week)
}

export async function startSessionShare($: EngineInterface): Promise<void> {
  for (const day of Object.keys(ledgerMine)) delete ledgerMine[day]
  turnsMine = []
  mineLoaded = false
  othersStale = true
  shareName = ''
  written.clear()
  agentTypes.clear()
  ledgerCost = (await $.session.usage()).cost?.usd ?? null
  await update($, turn, () => null)
}

export async function recordTurn($: EngineInterface, turnId: string): Promise<void> {
  const live = await read($, turn)
  if (live?.turnId !== turnId) return
  const [session, measured, now] = await Promise.all([$.session.id(), $.session.usage(), $.clock.now()])
  const record = turnToRecord(live, session, measured.cost?.usd ?? null)
  turnsMine = [...turnsMine.filter(t => t.id !== record.id), record]
  turnsDirty = true
  await publishTurns($, session, now)
  syncLedgerSoon($)
}

function syncLedgerSoon($: EngineInterface): void {
  ledgerTimer?.cancel()
  ledgerTimer = $.clock.after(LEDGER_WRITE_MS, () => {
    void syncLedger($)
  })
}

async function agentTypeOf($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return MAIN_AGENT
  const known = agentTypes.get(agentId)
  if (known) return known
  const type = await $.agent
    .list()
    .then(list => list.find(a => a.id === agentId)?.type)
    .catch(() => undefined)
  if (type) agentTypes.set(agentId, type)
  return type ?? 'agent'
}

const partTurns = new Map<string, string>()

async function recordStep($: EngineInterface, tokens: number, cost: number | null, agentId: string | undefined, model: string, effort: string | number | undefined, turnId: string): Promise<{ spent: number | null; before: number | null }> {
  const before = ledgerCost
  const [now, agent] = await Promise.all([$.clock.now(), agentTypeOf($, agentId)])
  const day = dayKey(now)
  const entry = (ledgerMine[day] ??= { tokens: 0, costStart: ledgerCost ?? cost, costEnd: cost })
  const agents = (entry.agents ??= {})
  const models = (entry.models ??= {})
  agents[agent] = (agents[agent] ?? 0) + tokens
  const level = effort === undefined ? '' : String(effort)
  models[modelKey(model, level)] = (models[modelKey(model, level)] ?? 0) + tokens
  const spent = cost === null || ledgerCost === null ? null : Math.max(0, cost - ledgerCost)
  const parts = (entry.parts ??= {})
  const key = partKey(agent, model, level)
  const part = parts[key]
  const isNewTurn = partTurns.get(`${day}\t${key}`) !== turnId
  partTurns.set(`${day}\t${key}`, turnId)
  parts[key] = part
    ? {
        tokens: part.tokens + tokens,
        costUsd: part.costUsd === null || spent === null ? null : part.costUsd + spent,
        ...(part.turns === undefined ? {} : { turns: part.turns + (isNewTurn ? 1 : 0) }),
      }
    : { tokens, costUsd: spent, turns: 1 }
  entry.tokens += tokens
  if (cost !== null) {
    entry.costEnd = cost
    ledgerCost = cost
  }
  syncLedgerSoon($)
  return { spent, before }
}

let tickTimer: Timer | undefined

async function nextTickDelay($: EngineInterface, cfg: Config): Promise<number> {
  const [sums, measured, now] = await Promise.all([read($, totals), read($, usage), $.clock.now()])
  return nextChangeMs(
    { now, agents: {}, turn: null, totals: sums, usage: measured, git: null, host: null, clients: 0, agentEfforts: {}, agentModels: {} },
    cfg,
  )
}

export function scheduleTick($: EngineInterface, cfg: Config): void {
  void nextTickDelay($, cfg)
    .catch(() => 60_000)
    .then(ms => {
    tickTimer?.cancel()
    tickTimer = $.clock.after(ms, () => {
      void $.clock
        .now()
        .then(now => update($, tick, () => now))
        .finally(() => scheduleTick($, cfg))
    })
  })
}

export async function seedLedgerCost($: EngineInterface): Promise<void> {
  ledgerCost = (await $.session.usage()).cost?.usd ?? null
}

export async function flushLedger($: EngineInterface): Promise<void> {
  ledgerTimer?.cancel()
  await syncLedger($)
}

export async function countCompaction($: EngineInterface, trigger: 'manual' | 'auto' | 'plugin'): Promise<void> {
  pendingCompaction = trigger
  await update($, usage, prev => (prev ? { ...prev, compactions: prev.compactions + 1 } : prev))
  void refreshCompactThreshold($)
}

export async function setCacheTtl($: EngineInterface, ttlMs: number): Promise<void> {
  await update($, totals, prev => ({ ...prev, cacheTtlMs: ttlMs }))
}

type CallStart = { costBefore: number | null; startedAt: number }

export async function startCall($: EngineInterface, e: TurnStepInput): Promise<CallStart> {
  const costBefore = e.agentId === undefined ? ((await $.session.usage()).cost?.usd ?? null) : null
  const startedAt = await $.clock.now()
  return { costBefore, startedAt }
}

export async function recordCall($: EngineInterface, cfg: Config, e: TurnStepInput, result: TurnStepResult, start: CallStart): Promise<void> {
  const { costBefore, startedAt } = start
  const u = result.usage
  if (!u) return
  const cost = (await $.session.usage()).cost?.usd ?? null
  const model = u.model || e.model
  const effort = e.effort === undefined ? {} : { effort: String(e.effort) }
  const { spent, before } = await recordStep($, u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens, cost, e.agentId, model, e.effort, e.turnId)
  if (e.agentId !== undefined) return

  const endedAt = await $.clock.now()
  const apiMs = endedAt - startedAt
  // The session's cost can rise after a call's own read of it, so a call and a turn count from the cost read at the step before.
  const callCost = spent ?? (cost === null || costBefore === null ? null : Math.max(0, cost - costBefore))
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
            costStartUsd: before ?? costBefore,
            costUsd: null,
            linesAdded: 0,
            linesRemoved: 0,
            files: [],
            start: startedAt,
            end: endedAt,
            model,
            ...effort,
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
      kind: callKind(e.index, result.toolUses.map(use => use.name)),
      model,
      ...effort,
    },
  ])
}
