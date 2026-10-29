import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer, SessionContextUsage, SessionCost, SessionRateLimit, TurnStepInput, TurnStepResult } from 'claude-code'

import type { IndexContextPoint, IndexRateLimit, IndexTurnRecord, IndexUsage } from '../types'
import { EMPTY_TOTALS, createdLines, mergeRateLimit, nextChangeMs, patchLineCounts, type Config } from './lib/format'
import { USAGE_DAYS } from './lib/panels'
import { isRecord, parseSharedLimits, serializeSharedLimits } from './lib/git'
import { dayKey, mergeLedger, parseLedger, serializeLedger, summarize, type LedgerEntry } from './lib/ledger'
import { mergeTurns, parseTurns, serializeTurns, turnToRecord } from './lib/turns'
import { callKind } from './lib/detail'
import { configDir, readJson, tempDir } from './host'
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

const EWMA_ALPHA = 0.3
const CONTEXT_LOG_MAX = 500

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

// Shares claude-statusline-ratelimits.json with statusline.py: same path and
// seconds-based shape, so the script and the band agree across open sessions.
export async function recordUsage($: EngineInterface, m: Measured): Promise<void> {
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
  if (await read($, detailOpen)) await refreshContextDetail($, false)
  if (pct === null) return
  const compaction = pendingCompaction
  pendingCompaction = undefined
  const lastPoint = (await read($, contextLog)).at(-1)
  const unchanged = (p: IndexContextPoint | undefined) => p !== undefined && p.percent === pct && p.tokens === (m.context.tokens ?? null) && !compaction
  const parts = unchanged(lastPoint) ? undefined : await readContextParts($)
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

async function readContextParts($: EngineInterface): Promise<Record<string, number> | undefined> {
  try {
    const breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    if (!breakdown) return undefined
    const parts: Record<string, number> = {}
    for (const c of breakdown.categories) if (c.kind === 'used') parts[c.name] = c.tokens
    return parts
  } catch {
    // Without a bound session the breakdown rejects; the point then carries no categories.
    return undefined
  }
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
const LEDGER_FILE = 'the-index-usage.json'
const TURNS_FILE = 'the-index-turns.json'
let turnsMine: IndexTurnRecord[] = []
let turnsDirty = false
let turnsLoaded = false
const ledgerMine: Record<string, LedgerEntry> = {}
let ledgerCost: number | null = null
let ledgerTimer: Timer | undefined
let ledgerLoaded = false

export async function syncLedger($: EngineInterface): Promise<void> {
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

export async function startSessionShare($: EngineInterface): Promise<void> {
  for (const day of Object.keys(ledgerMine)) delete ledgerMine[day]
  turnsMine = []
  ledgerLoaded = false
  turnsLoaded = false
  ledgerCost = (await $.session.usage()).cost?.usd ?? null
  await update($, turn, () => null)
}

export async function recordTurn($: EngineInterface, turnId: string): Promise<void> {
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

async function nextTickDelay($: EngineInterface, cfg: Config): Promise<number> {
  const [sums, measured, now] = await Promise.all([read($, totals), read($, usage), $.clock.now()])
  return nextChangeMs(
    { now, agents: {}, turn: null, totals: sums, usage: measured, git: null, host: null, clients: 0, agentEfforts: {}, agentModels: {} },
    cfg,
  )
}

export function scheduleTick($: EngineInterface, cfg: Config): void {
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
  const stepUsage = result.usage
  if (stepUsage) {
    await recordStep(
      $,
      stepUsage.input_tokens + stepUsage.cache_creation_input_tokens + stepUsage.cache_read_input_tokens + stepUsage.output_tokens,
    )
  }
  if (e.agentId !== undefined || !result.usage) return

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
      kind: callKind(e.index, result.toolUses.map(use => use.name)),
    },
  ])
}
