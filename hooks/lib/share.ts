import type { IndexAgentTotal, IndexDayTotal, IndexUsagePart, IndexSessionLog, IndexTurnRecord, IndexUsageLogDay, IndexUsageLogMonth, IndexUsageLogSession } from '../../types'
import { isRecord } from './git'
import { dayKey, entryCost, parseEntry, type Ledger, type LedgerEntry, modelOf } from './ledger'
import { parseTurns } from './turns'

const VERSION = 1
const MONTH = /^\d{4}-\d{2}$/

export const SHARE_DIR = 'the-index/usage'
export const TOTALS_DIR = 'totals'
export const KEEP_MONTHS = 3

export type SessionFile = {
  session: string
  name: string
  days: Record<string, LedgerEntry>
  turns: IndexTurnRecord[]
}

export function monthKey(ms: number): string {
  return dayKey(ms).slice(0, 7)
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return dayKey(new Date(y ?? 1970, (m ?? 1) - 2, 1).getTime()).slice(0, 7)
}

export function monthsBack(month: string, count: number): string {
  let out = month
  for (let i = 0; i < count; i += 1) out = previousMonth(out)
  return out
}

export function isMonth(name: string): boolean {
  return MONTH.test(name)
}

export function sessionFileName(session: string): string {
  return `${session}.json`
}

export function parseSessionFile(data: unknown): SessionFile | null {
  if (!isRecord(data) || data['version'] !== VERSION || typeof data['session'] !== 'string' || !isRecord(data['days'])) return null
  const days: Record<string, LedgerEntry> = {}
  for (const [date, raw] of Object.entries(data['days'])) {
    const entry = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseEntry(raw) : null
    if (entry) days[date] = entry
  }
  const name = data['name']
  return {
    session: data['session'],
    name: typeof name === 'string' ? name : '',
    days,
    turns: parseTurns({ version: VERSION, turns: data['turns'] }).filter(t => t.session === data['session']),
  }
}

// Keys are written in one order, so a session compares its file's text with what it last wrote.
export function serializeSessionFile(file: SessionFile): string {
  const days: Record<string, LedgerEntry> = {}
  for (const date of Object.keys(file.days).sort()) {
    const e = file.days[date]
    if (!e) continue
    days[date] = {
      tokens: e.tokens,
      costStart: e.costStart,
      costEnd: e.costEnd,
      ...(e.agents && Object.keys(e.agents).length ? { agents: e.agents } : {}),
      ...(e.models && Object.keys(e.models).length ? { models: e.models } : {}),
      ...(e.parts && Object.keys(e.parts).length ? { parts: e.parts } : {}),
    }
  }
  return JSON.stringify({ version: VERSION, session: file.session, name: file.name, days, turns: file.turns })
}

// A day's entry and a turn go in the file of the month they fall in, so a month's folder stops changing once the month has passed.
export function splitByMonth(
  session: string,
  name: string,
  days: Readonly<Record<string, LedgerEntry>>,
  turns: readonly IndexTurnRecord[],
): Record<string, SessionFile> {
  const out: Record<string, SessionFile> = {}
  const fileOf = (month: string) => (out[month] ??= { session, name, days: {}, turns: [] })
  for (const [date, entry] of Object.entries(days)) fileOf(date.slice(0, 7)).days[date] = entry
  for (const turn of turns) fileOf(monthKey(turn.at)).turns.push(turn)
  return out
}

export function ledgerOf(files: readonly SessionFile[]): Ledger {
  const ledger: Ledger = {}
  for (const file of files) {
    for (const [date, entry] of Object.entries(file.days)) {
      ;(ledger[date] ??= {})[file.session] = file.name ? { ...entry, name: file.name } : entry
    }
  }
  return ledger
}

export function monthTotal(files: readonly SessionFile[]): IndexDayTotal[] {
  const ledger = ledgerOf(files)
  return Object.keys(ledger)
    .sort()
    .map(date => {
      let tokens = 0
      let costUsd: number | null = null
      for (const entry of Object.values(ledger[date] ?? {})) {
        tokens += entry.tokens
        const cost = entryCost(entry)
        if (cost !== null) costUsd = (costUsd ?? 0) + cost
      }
      return { date, tokens, costUsd }
    })
}

function ranked(split: Readonly<Record<string, number>> | undefined): IndexAgentTotal[] {
  return Object.entries(split ?? {})
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
}

function rankedModels(split: Readonly<Record<string, number>> | undefined): IndexAgentTotal[] {
  const byModel: Record<string, number> = {}
  for (const [key, tokens] of Object.entries(split ?? {})) byModel[modelOf(key)] = (byModel[modelOf(key)] ?? 0) + tokens
  return ranked(byModel)
}

function partsOf(e: LedgerEntry): IndexUsagePart[] {
  return Object.entries(e.parts ?? {})
    .map(([key, part]) => {
      const [agent = '', model = '', effort = ''] = key.split('\t')
      return { agent, model, effort, tokens: part.tokens, costUsd: part.costUsd, turns: part.turns ?? null }
    })
    .sort((a, b) => b.tokens - a.tokens)
}

function dayTotal(date: string, sessions: readonly IndexUsageLogSession[]): IndexUsageLogDay {
  const costs = sessions.flatMap(s => (s.costUsd === null ? [] : [s.costUsd]))
  return {
    date,
    tokens: sessions.reduce((sum, s) => sum + s.tokens, 0),
    costUsd: costs.length ? costs.reduce((sum, c) => sum + c, 0) : null,
    sessions: [...sessions].sort((a, b) => b.tokens - a.tokens),
  }
}

// Every month on disk, newest first: an open month by day and session, a passed month by its day totals.
export function usageLogOf(files: readonly SessionFile[], closed: Readonly<Record<string, readonly IndexDayTotal[]>>): IndexUsageLogMonth[] {
  const byDay = new Map<string, IndexUsageLogSession[]>()
  for (const file of files) {
    for (const [date, e] of Object.entries(file.days)) {
      const session = {
        id: file.session,
        name: file.name,
        tokens: e.tokens,
        costUsd: entryCost(e),
        agents: ranked(e.agents),
        models: rankedModels(e.models),
        parts: partsOf(e),
        turns: file.turns.filter(t => dayKey(t.at) === date).length,
      }
      byDay.set(date, [...(byDay.get(date) ?? []), session])
    }
  }
  const months = new Map<string, IndexUsageLogDay[]>()
  for (const date of [...byDay.keys()].sort().reverse()) {
    const month = date.slice(0, 7)
    months.set(month, [...(months.get(month) ?? []), dayTotal(date, byDay.get(date) ?? [])])
  }
  const open = [...months].map(([month, days]) => ({ month, days }))
  const passed = Object.entries(closed)
    .filter(([month]) => !months.has(month))
    .map(([month, days]) => ({ month, days: [...days].reverse().map(d => ({ ...d, sessions: [] })) }))
  return [...open, ...passed].sort((a, b) => b.month.localeCompare(a.month))
}

export function sessionLogOf(month: string, file: SessionFile): IndexSessionLog {
  return { month, id: file.session, name: file.name, turns: [...file.turns].sort((a, b) => b.at - a.at) }
}

export function parseMonthTotal(data: unknown): IndexDayTotal[] | null {
  if (!isRecord(data) || data['version'] !== VERSION || !Array.isArray(data['days'])) return null
  return data['days'].flatMap((d): IndexDayTotal[] => {
    if (!isRecord(d) || typeof d['date'] !== 'string' || typeof d['tokens'] !== 'number' || !Number.isFinite(d['tokens'])) return []
    const cost = d['costUsd']
    return [{ date: d['date'], tokens: d['tokens'], costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null }]
  })
}

export function serializeMonthTotal(days: readonly IndexDayTotal[]): string {
  return JSON.stringify({ version: VERSION, days })
}
