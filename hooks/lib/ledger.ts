import type { IndexDayTotal, IndexUsageSummary, IndexWeekUsage } from '../../types'
import { isRecord } from './git'

export type LedgerEntry = {
  tokens: number
  costStart: number | null
  costEnd: number | null
  name?: string
  agents?: Record<string, number>
  models?: Record<string, number>
  parts?: Record<string, LedgerPart>
}

// One agent, model and effort level. Its cost is null once a step of it had no cost, so a cost never covers part of the tokens.
export type LedgerPart = { tokens: number; costUsd: number | null; turns?: number }

// A model's tokens are kept under the model and the effort level it ran at; an entry written before effort was recorded has the model alone.
export function modelKey(model: string, effort: string): string {
  return effort ? `${model}	${effort}` : model
}

export function modelOf(key: string): string {
  return key.split('	')[0] ?? key
}

export function partKey(agent: string, model: string, effort: string): string {
  return [agent, model, effort].join('\t')
}

export const WEEK_DAYS = 7
export const MAIN_AGENT = 'main'
export type Ledger = Record<string, Record<string, LedgerEntry>>

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function agentTokens(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null
  const out: Record<string, number> = {}
  for (const [agent, tokens] of Object.entries(value)) {
    const count = num(tokens)
    if (count !== null) out[agent] = count
  }
  return Object.keys(out).length ? out : null
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseEntry(entry: unknown): LedgerEntry | null {
  if (!isRecord(entry)) return null
  const tokens = num(entry['tokens'])
  if (tokens === null) return null
  const agents = agentTokens(entry['agents'])
  const models = agentTokens(entry['models'])
  const parts: Record<string, LedgerPart> = {}
  for (const [key, part] of Object.entries(isRecord(entry['parts']) ? entry['parts'] : {})) {
    const count = isRecord(part) ? num(part['tokens']) : null
    const turns = isRecord(part) ? num(part['turns']) : null
    if (isRecord(part) && count !== null) parts[key] = { tokens: count, costUsd: num(part['costUsd']), ...(turns === null ? {} : { turns }) }
  }
  return {
    tokens,
    costStart: num(entry['costStart']),
    costEnd: num(entry['costEnd']),
    ...(agents ? { agents } : {}),
    ...(models ? { models } : {}),
    ...(Object.keys(parts).length ? { parts } : {}),
  }
}

export function entryCost(entry: LedgerEntry): number | null {
  return entry.costStart === null || entry.costEnd === null ? null : Math.max(0, entry.costEnd - entry.costStart)
}

// `archived` holds the day totals of months that have passed, which are kept without their sessions.
export function summarize(ledger: Ledger, today: string, dayCount: number, archived: readonly IndexDayTotal[] = []): IndexUsageSummary {
  const dates = Object.keys(ledger).sort()
  const since = [...dates, ...archived.map(day => day.date)].sort()[0] ?? null
  let allTokens = archived.reduce((sum, day) => sum + day.tokens, 0)
  let allCostUsd = archived.reduce((sum, day) => sum + (day.costUsd ?? 0), 0)
  // Early in a month after a short one, the chart's first days fall in a month that has passed.
  const byDate = new Map<string, IndexDayTotal>(archived.map(day => [day.date, day]))
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
  const days: IndexDayTotal[] = []
  const [y, m, d] = today.split('-').map(Number)
  for (let back = dayCount - 1; back >= 0; back -= 1) {
    const date = dayKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - back).getTime())
    days.push(byDate.get(date) ?? { date, tokens: 0, costUsd: null })
  }
  return { days, allTokens, allCostUsd, since, week: weekUsage(ledger, days.slice(-WEEK_DAYS).map(day => day.date)) }
}


function weekUsage(ledger: Ledger, dates: readonly string[]): IndexWeekUsage {
  const models = new Map<string, number>()
  let tokens = 0
  let costUsd: number | null = null
  for (const date of dates) {
    for (const entry of Object.values(ledger[date] ?? {})) {
      tokens += entry.tokens
      const cost = entryCost(entry)
      if (cost !== null) costUsd = (costUsd ?? 0) + cost
      for (const [key, count] of Object.entries(entry.models ?? {})) models.set(modelOf(key), (models.get(modelOf(key)) ?? 0) + count)
    }
  }
  return { days: dates.length, tokens, costUsd, models: [...models].map(([name, count]) => ({ name, tokens: count })).sort((a, b) => b.tokens - a.tokens) }
}
