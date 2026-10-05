import type { IndexTurnRecord } from '../types'
import { isRecord } from './git'

const VERSION = 1
export const HISTORY_MS = 7 * 86_400_000

export type Averages = {
  cost: number | null
  costPerMTok: number | null
  cacheHit: number | null
  tps: number | null
  output: number | null
  linesAdded: number | null
  linesRemoved: number | null
  linesPerMin: number | null
  costPerLine: number | null
  files: number | null
}

export type SessionTotals = {
  turns: number
  tokens: number
  cacheHit: number | null
  tps: number | null
  cost: number | null
  costPerTurn: number | null
  linesAdded: number
  linesRemoved: number
  linesPerMin: number | null
  costPerLine: number | null
}

const KEYS = ['at', 'tokens', 'input', 'cacheRead', 'output', 'apiMs', 'spanMs', 'linesAdded', 'linesRemoved', 'files'] as const

export function parseTurns(data: unknown): IndexTurnRecord[] {
  if (!isRecord(data) || data['version'] !== VERSION || !Array.isArray(data['turns'])) return []
  return data['turns'].flatMap(t => {
    if (!isRecord(t) || typeof t['session'] !== 'string' || typeof t['id'] !== 'string') return []
    if (!KEYS.every(k => typeof t[k] === 'number' && Number.isFinite(t[k]))) return []
    const cost = t['costUsd']
    return [
      {
        id: t['id'],
        session: t['session'],
        ...(Object.fromEntries(KEYS.map(k => [k, t[k] as number])) as Record<(typeof KEYS)[number], number>),
        costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
      },
    ]
  })
}

export function mergeTurns(
  onDisk: readonly IndexTurnRecord[],
  session: string,
  mine: readonly IndexTurnRecord[],
  now: number,
): IndexTurnRecord[] {
  const kept = onDisk.filter(t => t.session !== session)
  return [...kept, ...mine].filter(t => now - t.at <= HISTORY_MS).sort((a, b) => a.at - b.at)
}

export function serializeTurns(turns: readonly IndexTurnRecord[]): string {
  return JSON.stringify({ version: VERSION, turns })
}

function sum(turns: readonly IndexTurnRecord[], pick: (t: IndexTurnRecord) => number): number {
  return turns.reduce((total, t) => total + pick(t), 0)
}

function priced(turns: readonly IndexTurnRecord[]): IndexTurnRecord[] {
  return turns.filter(t => t.costUsd !== null)
}

function lines(t: IndexTurnRecord): number {
  return t.linesAdded + t.linesRemoved
}

function meanTps(turns: readonly IndexTurnRecord[]): number | null {
  const timed = turns.filter(t => t.output > 0 && t.apiMs > 0)
  return timed.length ? sum(timed, t => t.output / (t.apiMs / 1000)) / timed.length : null
}

function costPerLine(turns: readonly IndexTurnRecord[]): number | null {
  const withLines = priced(turns).filter(t => lines(t) > 0)
  const total = sum(withLines, lines)
  return total > 0 ? sum(withLines, t => t.costUsd ?? 0) / total : null
}

function linesPerMin(turns: readonly IndexTurnRecord[]): number | null {
  const working = turns.filter(t => lines(t) > 0)
  const minutes = sum(working, t => t.spanMs) / 60_000
  return minutes > 0 ? sum(working, lines) / minutes : null
}

export function turnAverages(turns: readonly IndexTurnRecord[]): Averages {
  if (turns.length === 0) {
    return {
      cost: null,
      costPerMTok: null,
      cacheHit: null,
      tps: null,
      output: null,
      linesAdded: null,
      linesRemoved: null,
      linesPerMin: null,
      costPerLine: null,
      files: null,
    }
  }
  const paid = priced(turns)
  const paidTokens = sum(paid, t => t.tokens)
  const input = sum(turns, t => t.input)
  return {
    cost: paid.length ? sum(paid, t => t.costUsd ?? 0) / paid.length : null,
    costPerMTok: paidTokens > 0 ? (sum(paid, t => t.costUsd ?? 0) / paidTokens) * 1_000_000 : null,
    cacheHit: input > 0 ? (sum(turns, t => t.cacheRead) / input) * 100 : null,
    tps: meanTps(turns),
    output: sum(turns, t => t.output) / turns.length,
    linesAdded: sum(turns, t => t.linesAdded) / turns.length,
    linesRemoved: sum(turns, t => t.linesRemoved) / turns.length,
    linesPerMin: linesPerMin(turns),
    costPerLine: costPerLine(turns),
    files: sum(turns, t => t.files) / turns.length,
  }
}

export function sessionTotals(turns: readonly IndexTurnRecord[]): SessionTotals {
  const paid = priced(turns)
  const input = sum(turns, t => t.input)
  const cost = paid.length ? sum(paid, t => t.costUsd ?? 0) : null
  return {
    turns: turns.length,
    tokens: sum(turns, t => t.tokens),
    cacheHit: input > 0 ? (sum(turns, t => t.cacheRead) / input) * 100 : null,
    tps: meanTps(turns),
    cost,
    costPerTurn: cost !== null && paid.length ? cost / paid.length : null,
    linesAdded: sum(turns, t => t.linesAdded),
    linesRemoved: sum(turns, t => t.linesRemoved),
    linesPerMin: linesPerMin(turns),
    costPerLine: costPerLine(turns),
  }
}

export function otherSessionAverages(history: readonly IndexTurnRecord[], session: string): SessionTotals | null {
  const bySession = new Map<string, IndexTurnRecord[]>()
  for (const t of history) {
    if (t.session === session) continue
    bySession.set(t.session, [...(bySession.get(t.session) ?? []), t])
  }
  const totals = [...bySession.values()].map(sessionTotals)
  if (totals.length === 0) return null
  const mean = (pick: (s: SessionTotals) => number | null) => {
    const known = totals.map(pick).filter((v): v is number => v !== null)
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
  }
  return {
    turns: mean(s => s.turns) ?? 0,
    tokens: mean(s => s.tokens) ?? 0,
    cacheHit: mean(s => s.cacheHit),
    tps: mean(s => s.tps),
    cost: mean(s => s.cost),
    costPerTurn: mean(s => s.costPerTurn),
    linesAdded: mean(s => s.linesAdded) ?? 0,
    linesRemoved: mean(s => s.linesRemoved) ?? 0,
    linesPerMin: mean(s => s.linesPerMin),
    costPerLine: mean(s => s.costPerLine),
  }
}
