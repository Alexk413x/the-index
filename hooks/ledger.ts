import type { IndexDayTotal, IndexUsageSummary } from '../types'
import { isRecord } from './git'

export type LedgerEntry = { tokens: number; costStart: number | null; costEnd: number | null }
export type Ledger = Record<string, Record<string, LedgerEntry>>
export type DayTotal = IndexDayTotal
export type UsageSummary = IndexUsageSummary

const VERSION = 1

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseLedger(data: unknown): Ledger {
  const out: Ledger = {}
  if (!isRecord(data) || data['version'] !== VERSION || !isRecord(data['days'])) return out
  for (const [date, sessions] of Object.entries(data['days'])) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRecord(sessions)) continue
    for (const [sid, entry] of Object.entries(sessions)) {
      if (!isRecord(entry)) continue
      const tokens = num(entry['tokens'])
      if (tokens === null) continue
      ;(out[date] ??= {})[sid] = { tokens, costStart: num(entry['costStart']), costEnd: num(entry['costEnd']) }
    }
  }
  return out
}

export function mergeLedger(onDisk: Ledger, sessionId: string, mine: Readonly<Record<string, LedgerEntry>>): Ledger {
  const merged: Ledger = {}
  for (const [date, sessions] of Object.entries(onDisk)) merged[date] = { ...sessions }
  for (const [date, entry] of Object.entries(mine)) (merged[date] ??= {})[sessionId] = entry
  return merged
}

export function serializeLedger(ledger: Ledger): string {
  return JSON.stringify({ version: VERSION, days: ledger })
}

function entryCost(entry: LedgerEntry): number | null {
  return entry.costStart === null || entry.costEnd === null ? null : Math.max(0, entry.costEnd - entry.costStart)
}

export function summarize(ledger: Ledger, today: string, dayCount: number): UsageSummary {
  const dates = Object.keys(ledger).sort()
  const since = dates[0] ?? null
  let allTokens = 0
  let allCostUsd = 0
  const byDate = new Map<string, DayTotal>()
  for (const date of dates) {
    let tokens = 0
    let costUsd: number | null = null
    for (const entry of Object.values(ledger[date] ?? {})) {
      tokens += entry.tokens
      const cost = entryCost(entry)
      if (cost !== null) costUsd = (costUsd ?? 0) + cost
    }
    allTokens += tokens
    allCostUsd += costUsd ?? 0
    byDate.set(date, { date, tokens, costUsd })
  }
  const days: DayTotal[] = []
  const [y, m, d] = today.split('-').map(Number)
  for (let back = dayCount - 1; back >= 0; back -= 1) {
    const date = dayKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - back).getTime())
    days.push(byDate.get(date) ?? { date, tokens: 0, costUsd: null })
  }
  return { days, allTokens, allCostUsd, since }
}
