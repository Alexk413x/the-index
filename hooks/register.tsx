import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { IndexEffort, IndexHarness, IndexPanel, IndexGit, IndexRateLimit, IndexUsage } from '../types'
import {
  EMPTY_TOTALS,
  MAIN,
  buildLines,
  fmtNum,
  MODEL_CHOICES,
  mergeRateLimit,
  modelLabel,
  nextChangeMs,
  normPath,
  patchLineCounts,
  projectName,
  readConfig,
  type Config,
  type Menu,
  type Seg,
  type ViewedAgent,
} from './format'
import {
  BASE_REFS,
  applyBase,
  applyPr,
  applyStatus,
  emptyGit,
  isRecord,
  numstatTotals,
  parseJson,
  parseSharedLimits,
  serializeSharedLimits,
} from './git'

const agents = atom({ plugin: 'the-index', key: 'agents' } as const, {})
const call = atom({ plugin: 'the-index', key: 'call' } as const, null)
const totals = atom({ plugin: 'the-index', key: 'totals' } as const, EMPTY_TOTALS)
const usage = atom({ plugin: 'the-index', key: 'usage' } as const, null)
const git = atom({ plugin: 'the-index', key: 'git' } as const, null)
const host = atom({ plugin: 'the-index', key: 'host' } as const, null)
const tick = atom({ plugin: 'the-index', key: 'tick' } as const, 0)
const clients = atom({ plugin: 'the-index', key: 'clients' } as const, {})
const efforts = atom({ plugin: 'the-index', key: 'efforts' } as const, {})
const pinned = atom({ plugin: 'the-index', key: 'pinned' } as const, [])
const slots = atom({ plugin: 'the-index', key: 'slots' } as const, [])
const hover = atom({ plugin: 'the-index', key: 'hover' } as const, null)
const harnesses = atom({ plugin: 'the-index', key: 'harnesses' } as const, null)
const fading = atom({ plugin: 'the-index', key: 'fading' } as const, false)
const ultracode = atom({ plugin: 'the-index', key: 'ultracode' } as const, false)
const models = atom({ plugin: 'the-index', key: 'models' } as const, {})

const EWMA_ALPHA = 0.3
const COMPACTION_DROP = 30
const GIT_STAT_EVERY_MS = 30_000
const GIT_FULL_EVERY_MS = 300_000
const GIT_DEBOUNCE_MS = 2000
const HOST_MIN_GAP_MS = 300_000
const PR_CACHE_MS = 300_000
const prCache = new Map<string, { at: number; pr: { number: number; url: string } | null }>()
const GIT_STAMP_FILES = ['index', 'HEAD', 'FETCH_HEAD', 'ORIG_HEAD']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

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

function settingsEffort(value: unknown): IndexEffort | undefined {
  if (typeof value === 'number') return value
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value) ? (value as IndexEffort) : undefined
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
    const r = await $.process.run(['git', '-C', cwd, '-c', 'gc.auto=0', '--no-optional-locks', ...args], {
      timeoutMs: 5000,
    })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function gitSnapshot($: EngineInterface, cwd: string): Promise<IndexGit | null> {
  const [status, diff, refsOut, remote] = await Promise.all([
    runGit($, cwd, ['status', '--porcelain=v2', '--branch']),
    runGit($, cwd, ['diff', '--numstat', 'HEAD']),
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
    runGit($, cwd, ['diff', '--raw', '--numstat', `${snap.prBaseRef}...HEAD`]),
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

async function refreshGit($: EngineInterface): Promise<void> {
  const snap = await gitSnapshot($, await $.session.cwd())
  await update($, git, () => snap)
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
    { now, agents: {}, call: null, totals: sums, usage: measured, git: null, host: null, clients: 0, efforts: {}, models: {} },
    cfg,
  )
}

async function refreshHost($: EngineInterface): Promise<void> {
  const [cwd, id, model, settings, dir, version] = await Promise.all([
    $.session.cwd(),
    $.session.id(),
    $.session.model(),
    $.settings.read(),
    configDir($),
    $.session.version(),
  ])
  const [entry, ide] = await Promise.all([sessionEntry($, dir, id), detectIde($, dir, cwd)])
  const agentSetting = settings['agent']
  const effort = await savedEffort($, model)
  await update($, host, () => ({
    sessionName: entry.name,
    sessionId: id,
    bridged: entry.bridged,
    bridgeId: entry.bridgeId,
    cwd,
    version: version.version,
    ide,
    agentName: typeof agentSetting === 'string' && agentSetting ? agentSetting : 'Claude',
    project: projectName(cwd),
    model,
    effort,
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

async function savedEffort($: EngineInterface, model: string): Promise<IndexEffort | undefined> {
  const settings = await $.settings.read()
  const perModel = settings['modelSettings']
  const entry = isRecord(perModel) ? perModel[model.replace(/\[1m\]$/, '')] : undefined
  return settingsEffort(isRecord(entry) ? entry['effortLevel'] : undefined) ?? settingsEffort(settings['effortLevel'])
}

async function followModel($: EngineInterface, model: string): Promise<void> {
  const effort = await savedEffort($, model)
  await update($, agents, prev => ({ ...prev, [MAIN]: { model, effort: effort ?? prev[MAIN]?.effort } }))
}

async function openFolder($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  // explorer.exe opens its window behind the focused app; the shell's Open brings it to the front.
  const windowsPath = cwd.replace(/\//g, '\\').replace(/'/g, "''")
  const argv = isWindows
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Shell.Application).Open('${windowsPath}')`]
    : ['open', cwd]
  try {
    await $.process.run(argv, { timeoutMs: 10_000 })
  } catch {
    try {
      await $.process.run(['xdg-open', cwd], { timeoutMs: 10_000 })
    } catch {
      $.ui.toast(`Could not open ${cwd}`)
    }
  }
}

async function switchMainEffort($: EngineInterface, level: IndexEffort | 'auto'): Promise<void> {
  const result = await $.command.run({ command: 'effort', args: String(level) })
  const text = commandText(result)
  if (text) $.ui.toast((text.split(':')[0] ?? text).replace(/`/g, ''))
  await update($, agents, prev => ({ ...prev, [MAIN]: { model: prev[MAIN]?.model ?? '', effort: level } }))
}

async function refreshHostUntilLinked($: EngineInterface): Promise<void> {
  if ((await read($, host))?.bridged) return
  await refreshHost($)
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

  const { startedAt } = await $.session.usage()
  await update($, usage, (prev): IndexUsage => {
    const pct = m.context.percent ?? null
    const last = prev?.lastPercent ?? null
    const dropped = pct !== null && last !== null && last - pct >= COMPACTION_DROP
    return {
      startedAt,
      contextPercent: pct,
      contextTokens: m.context.tokens ?? null,
      costUsd: m.cost?.usd ?? null,
      fiveHour,
      sevenDay,
      compactions: (prev?.compactions ?? 0) + (dropped ? 1 : 0),
      lastPercent: pct ?? last,
    }
  })
}

async function recordEdit($: EngineInterface, result: unknown): Promise<void> {
  if (!isRecord(result) || result['staged'] === true) return
  const patch = Array.isArray(result['structuredPatch']) ? (result['structuredPatch'] as { lines: string[] }[]) : []
  const { added, removed } = patchLineCounts(patch)
  if (!added && !removed) return
  await update($, totals, prev => ({
    ...prev,
    linesAdded: prev.linesAdded + added,
    linesRemoved: prev.linesRemoved + removed,
  }))
}

let tickTimer: Timer | undefined
let gitTimer: Timer | undefined
let gitDir = ''
let lastStamp = ''
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

const PANELS: readonly IndexPanel[] = ['harness', 'effort', 'model', 'session']
const AGENT_TABS = 'plugin:ide-agent-tabs:ide-agent-tabs'
// Must match GAP in row.tsx, which lays the row out.
const ROW_GAP = 2
const ULTRACODE = /\bultracode\b/i
const TITLE_WIDTH = 10
const MIDDLE_WIDTH = 60
const PIN_ON = '■'
const PIN_OFF = '□'
const PIN_SPACE = ' '

function withPanel(list: readonly IndexPanel[], panel: IndexPanel, isOpen: boolean): IndexPanel[] {
  const rest = list.filter(p => p !== panel)
  return isOpen ? [panel, ...rest] : rest
}

const HOVER_OPEN_MS = 100
const FADE_OUT_FALLBACK_MS = 1000
let hoverTimer: Timer | undefined
const pointerOver = new Set<string>()

function forgetPointer(panel: IndexPanel): void {
  for (const key of [...pointerOver]) if (key.startsWith(`${panel}-`)) pointerOver.delete(key)
}

function placeSlot($: EngineInterface, panel: IndexPanel): Promise<unknown> {
  return update($, slots, list => (list.includes(panel) ? list : [...list, panel]))
}

function dropSlot($: EngineInterface, panel: IndexPanel): Promise<unknown> {
  return update($, slots, list => list.filter(p => p !== panel))
}

function hoverOpenSoon($: EngineInterface, panel: IndexPanel): void {
  hoverTimer?.cancel()
  hoverTimer = $.clock.after(HOVER_OPEN_MS, () => {
    void Promise.all([update($, hover, () => panel), update($, fading, () => false), placeSlot($, panel)])
  })
}

function hoverKeep($: EngineInterface): void {
  hoverTimer?.cancel()
  void update($, fading, () => false)
}

function hoverCloseSoon($: EngineInterface): void {
  hoverTimer?.cancel()
  void update($, fading, () => true)
  hoverTimer = $.clock.after(FADE_OUT_FALLBACK_MS, () => {
    void hoverClose($)
  })
}

async function hoverClose($: EngineInterface): Promise<void> {
  hoverTimer?.cancel()
  const [closing, pinnedList] = await Promise.all([read($, hover), read($, pinned)])
  await Promise.all([update($, hover, () => null), update($, fading, () => false)])
  if (closing && !pinnedList.includes(closing)) await dropSlot($, closing)
}

async function togglePin($: EngineInterface, panel: IndexPanel): Promise<void> {
  hoverTimer?.cancel()
  const wasPinned = (await read($, pinned)).includes(panel)
  await update($, pinned, list => withPanel(list, panel, !wasPinned))
  if (!wasPinned) {
    await placeSlot($, panel)
  } else if ([...pointerOver].some(key => key.startsWith(`${panel}-`))) {
    await Promise.all([update($, hover, () => panel), update($, fading, () => false)])
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
      await update($, efforts, prev => {
        const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== target))
        return level ? { ...rest, [target]: level } : rest
      })
    }
  } else if (panel === 'model') {
    const choice = MODEL_CHOICES.find(c => c.alias === pick)
    if (!choice && pick !== 'default') return
    if (target === MAIN) await switchMainModel($, choice?.alias ?? 'default', choice?.id)
    else {
      await update($, models, prev => {
        const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== target))
        return choice ? { ...rest, [target]: choice.id } : rest
      })
    }
  } else {
    return
  }
  hoverTimer?.cancel()
  forgetPointer(panel)
  await update($, pinned, list => withPanel(list, panel, false))
  await Promise.all([update($, hover, () => null), update($, fading, () => false), dropSlot($, panel)])
}

function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'index-effort', description: "Open the band's effort row" })
    await $.command.register({ name: 'index-debug', description: 'Show what the band holds next to what Claude Code reports' })
    const cwd = await $.session.cwd()
    gitDir = (await runGit($, cwd, ['rev-parse', '--absolute-git-dir'])).replace(/\\/g, '/')
    await Promise.allSettled([
      refreshHost($),
      refreshGit($),
      loadHarnesses($),
      $.session.usage().then(u => recordUsage($, u)),
    ])
    hostAt = await $.clock.now()
    lastStamp = await gitStamp($, gitDir)
    scheduleTick($, cfg)
    $.clock.every(GIT_STAT_EVERY_MS, () => {
      void gitStamp($, gitDir).then(stamp => {
        if (stamp !== lastStamp) refreshGitSoon($)
      })
    })
    $.clock.every(GIT_STAT_EVERY_MS, () => {
      void refreshHostUntilLinked($)
    })
    $.clock.every(GIT_FULL_EVERY_MS, () => refreshGitSoon($))
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
      if (isName && (await read($, hover)) !== panel) hoverOpenSoon($, panel)
      else hoverKeep($)
    } else if (data['hover'] === false) {
      pointerOver.delete(e.element)
      if (![...pointerOver].some(key => key.startsWith(`${panel}-`))) hoverCloseSoon($)
    } else if (data['press'] === true && (isName || e.element === `${panel}-pin`)) {
      await togglePin($, panel)
    } else if (data['faded'] === true && e.element === `${panel}-row`) {
      if (await read($, fading)) await hoverClose($)
    } else if (typeof data['pick'] === 'string' && e.element === `${panel}-row`) {
      await applyPick($, panel, typeof data['target'] === 'string' ? data['target'] : MAIN, data['pick'])
    }
    return {}
  })

  on('command.run', { command: 'index-debug' }, async $ => {
    const [liveModel, settings, steps, chosen, overrides, hostInfo] = await Promise.all([
      $.session.model(),
      $.settings.read(),
      read($, agents),
      read($, efforts),
      read($, models),
      read($, host),
    ])
    const report = {
      sessionModel: liveModel,
      settingsModel: settings['model'],
      savedEffortForSessionModel: await savedEffort($, liveModel),
      bandMain: steps[MAIN] ?? null,
      bandSubagents: Object.fromEntries(Object.entries(steps).filter(([k]) => k !== MAIN)),
      subagentEffortPicks: chosen,
      subagentModelPicks: overrides,
      hostModel: hostInfo?.model ?? null,
    }
    return { text: ['```json', JSON.stringify(report, null, 2), '```'].join('\n') }
  })

  on('command.run', { command: 'index-effort' }, async $ => {
    await update($, pinned, list => withPanel(list, 'effort', true))
    await placeSlot($, 'effort')
    return { text: 'The effort row is open above the band. To set a level directly, run /effort.' }
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
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
    const [chosenEfforts, chosenModels] = await Promise.all([read($, efforts), read($, models)])
    const picked = chosenEfforts[key]
    const chosen = picked === 'auto' ? undefined : picked
    const chosenModel = chosenModels[key]
    const effort = chosen ?? e.effort
    const model = chosenModel ?? e.model
    await update($, agents, prev => ({ ...prev, [key]: { model, effort } }))
    const startedAt = await $.clock.now()
    const sent = chosen === undefined && chosenModel === undefined ? e : { ...e, model, effort }
    const result = yield* next(sent)
    const answeredBy = result.usage?.model
    if (answeredBy) await update($, agents, prev => ({ ...prev, [key]: { model: answeredBy, effort } }))
    if (chosenModel !== undefined && result.stopReason === null && !result.usage) {
      await update($, models, prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))
      await update($, agents, prev => ({ ...prev, [key]: { model: e.model, effort } }))
      $.ui.toast(`${modelLabel(chosenModel)} did not answer, so the band went back to the session's model.`)
    }
    if (e.agentId !== undefined || !result.usage) return result

    const endedAt = await $.clock.now()
    const u = result.usage
    const apiMs = endedAt - startedAt
    const cost = (await $.session.usage()).cost?.usd ?? null
    const totalIn = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
    const hitFrac = totalIn > 0 ? u.cache_read_input_tokens / totalIn : 0

    let before = EMPTY_TOTALS
    await update($, totals, prev => {
      before = prev
      return {
        ...prev,
        requests: prev.requests + 1,
        input: prev.input + u.input_tokens,
        cacheWrite: prev.cacheWrite + u.cache_creation_input_tokens,
        cacheRead: prev.cacheRead + u.cache_read_input_tokens,
        apiMs: prev.apiMs + apiMs,
        ewmaHit: prev.ewmaHit === null ? hitFrac : EWMA_ALPHA * hitFrac + (1 - EWMA_ALPHA) * prev.ewmaHit,
        lastResponseAt: endedAt,
        markAdded: prev.linesAdded,
        markRemoved: prev.linesRemoved,
        markCostUsd: cost,
      }
    })
    scheduleTick($, cfg)
    await update($, call, () => ({
      input: u.input_tokens,
      cacheWrite: u.cache_creation_input_tokens,
      cacheRead: u.cache_read_input_tokens,
      output: u.output_tokens,
      apiMs,
      costUsd: cost === null ? null : cost - (before.markCostUsd ?? cost),
      linesAdded: before.linesAdded - before.markAdded,
      linesRemoved: before.linesRemoved - before.markRemoved,
    }))
    return result
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    if ((e.tool === 'Edit' || e.tool === 'Write') && !r.isError) await recordEdit($, r.result)
    if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'Bash') refreshGitSoon($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    refreshGitSoon($)
    const now = await $.clock.now()
    if (now - hostAt >= HOST_MIN_GAP_MS) {
      hostAt = now
      await refreshHost($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [agentSteps, lastCall, sums, measured, repo, hostInfo, , remotes, chosen, openPanels, modelList, hovered, isFading, harnessList, ultracodeOn, slotOrder] =
      await Promise.all([
      read($, agents),
      read($, call),
      read($, totals),
      read($, usage),
      read($, git),
      read($, host),
      read($, tick),
      read($, clients),
      read($, efforts),
      read($, pinned),
      read($, models),
      read($, hover),
      read($, fading),
      read($, harnesses),
      read($, ultracode),
      read($, slots),
    ])
    const now = await $.clock.now()
    const [liveModel, settings] = await Promise.all([$.session.model(), $.settings.read()])
    const mainSteps = liveModel
      ? { ...agentSteps, [MAIN]: { model: liveModel, effort: agentSteps[MAIN]?.effort } }
      : agentSteps

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

    const lines = buildLines(
      {
        now,
        agents: mainSteps,
        call: lastCall,
        totals: sums,
        usage: measured,
        git: repo,
        host: hostInfo,
        clients: Object.keys(remotes).length,
        efforts: chosen,
        models: modelList,
      },
      cfg,
      viewed,
    )
    if (lines.length === 0) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Text, Link, Button } = table
    const Client = 'Client' in table ? table.Client : undefined
    const sep: Seg = { text: ' | ', color: cfg.colors.icons }
    const recache = measured?.contextTokens ? `about ${fmtNum(measured.contextTokens)} tokens` : 'the conversation'

    const isOpen = (panel: IndexPanel) => openPanels.includes(panel)
    const togglePanel = (panel: IndexPanel) => update($, pinned, list => withPanel(list, panel, !list.includes(panel)))
    const menuControl = (s: Seg) => {
      const panel = s.menu as IndexPanel
      if (panel === 'harness' && !harnessList) return <Text color={s.color}>{s.text}</Text>
      return Client ? (
        <Client
          key={`${panel}-chip`}
          module="./chip.tsx"
          props={{ text: s.text, color: s.color, isActive: isOpen(panel) }}
        />
      ) : (
        <Button
          key={`${panel}-button`}
          plain
          label={s.text}
          hover={{ color: s.color }}
          onPress={() => togglePanel(panel)}
        />
      )
    }

    type RowItem = { text: string; color: string; pick?: string; pad?: number }
    const note = (text: string): RowItem => ({ text, color: cfg.colors.icons })

    const target = viewed?.id ?? MAIN
    const currentEffort = chosen[target] ?? mainSteps[target]?.effort ?? (target === MAIN ? hostInfo?.effort : undefined)
    const currentModel = (
      modelList[target] ??
      mainSteps[target]?.model ??
      (target === MAIN ? hostInfo?.model : undefined) ??
      ''
    ).replace(/\[1m\]$/, '')
    const choice = (text: string, pick: string, isCurrent: boolean): RowItem =>
      isCurrent ? { text, color: cfg.colors.model } : { text, color: cfg.colors.icons, pick }

    const savedModel = typeof settings['model'] === 'string' ? settings['model'] : ''
    const perModel = isRecord(settings['modelSettings']) ? settings['modelSettings'][currentModel] : undefined
    const savedLevel = isRecord(perModel) ? perModel['effortLevel'] : settings['effortLevel']
    const modelIsDefault = target === MAIN ? savedModel === '' || savedModel === 'default' : modelList[target] === undefined
    const effortIsDefault =
      target === MAIN
        ? chosen[MAIN] === 'auto' || mainSteps[MAIN]?.effort === 'auto' || savedLevel === undefined || savedLevel === 'auto'
        : chosen[target] === undefined
    const attached = Object.keys(remotes).length
    const harnessChoices = (harnessList ?? []).map(h => choice(h.label, h.name, false))
    const effortChoices = [
      ...EFFORTS.map(level => choice(level, level, level === currentEffort)),
      note('·'),
      { text: 'ultracode', color: ultracodeOn ? cfg.colors.model : cfg.colors.icons, pick: 'ultracode' },
    ]
    const modelChoices = MODEL_CHOICES.map(c => choice(modelLabel(c.id), c.alias, c.id === currentModel))
    const sectionWidth = (items: RowItem[]) =>
      items.reduce((sum, item) => sum + item.text.length + (item.pad ?? 0), 0) + ROW_GAP * Math.max(0, items.length - 1)
    const padTo = (items: RowItem[], width: number): RowItem[] => {
      const last = items[items.length - 1]
      if (!last) return items
      return [...items.slice(0, -1), { ...last, pad: (last.pad ?? 0) + Math.max(0, width - sectionWidth(items)) }]
    }
    const middle = (items: RowItem[]) => padTo(items, MIDDLE_WIDTH)
    const middleEndingWith = (items: RowItem[], end: RowItem) => [
      ...padTo(items, MIDDLE_WIDTH - ROW_GAP - end.text.length),
      end,
    ]
    const title = (text: string): RowItem => ({ ...note(text), pad: Math.max(0, TITLE_WIDTH - text.length) })

    const sessionTable = (): RowItem[][] => {
      if (!hostInfo) return []
      const value = (text: string, color = cfg.colors.session): RowItem => ({ text, color })
      const rows: [string, RowItem[], RowItem | null][] = [
        [
          'Session',
          [value(hostInfo.sessionName || 'unnamed'), note('·'), value(hostInfo.sessionId ?? '')],
          measured ? note(`started ${clockTime(measured.startedAt)}`) : null,
        ],
        ...(hostInfo.bridgeId
          ? ([
              [
                'Remote',
                [value(hostInfo.bridgeId, attached ? cfg.colors.good : cfg.colors.session)],
                note(attached ? `${attached} attached` : 'none attached'),
              ],
            ] as [string, RowItem[], RowItem | null][])
          : []),
        ['Folder', [value(hostInfo.cwd ?? '')], note(`Claude Code ${hostInfo.version ?? ''}`)],
      ]
      return rows.map(([label, values, extra]) => [title(label), ...middle(values), ...(extra ? [extra] : [])])
    }

    const linesFor = (panel: IndexPanel, pinnedRow: boolean): RowItem[][] => {
      if (panel === 'harness') {
        return harnessList ? [[title('Open'), ...middle(harnessChoices), note('in a new tab')]] : []
      }
      if (panel === 'effort') {
        return [
          [
            title('Effort'),
            ...middleEndingWith(effortChoices, choice('default', 'default', effortIsDefault)),
            note(`may re-cache ${recache}`),
          ],
        ]
      }
      if (panel === 'model') {
        return [
          [
            title('Model'),
            ...middleEndingWith(modelChoices, choice('default', 'default', modelIsDefault)),
            note(`may re-cache ${recache}`),
          ],
        ]
      }
      return sessionTable()
    }

    const panelBlock = (panel: IndexPanel, pinnedRow: boolean) => {
      const panelLines = linesFor(panel, pinnedRow)
      if (!Client || panelLines.length === 0) return null
      return (
        <Box key={`${panel}-block`} flexDirection="row" gap={1}>
          <Box flexDirection="column">
            <Client
              key={`${panel}-pin`}
              module="./chip.tsx"
              props={{ text: pinnedRow ? PIN_ON : PIN_OFF, color: cfg.colors.model }}
            />
            {panelLines.slice(1).map((_, i) => (
              <Text key={`${panel}-pin-space${i}`}>{PIN_SPACE}</Text>
            ))}
          </Box>
          <Client
            key={`${panel}-row`}
            module="./row.tsx"
            props={{ lines: panelLines, hoverColor: cfg.colors.model, fade: !pinnedRow, closing: !pinnedRow && isFading, target }}
          />
        </Box>
      )
    }

    const shown = new Set(lines.flat(2).map(s => s.menu))
    const panels = PANELS.filter(p => shown.has(p))

    const order = [...slotOrder, ...[...openPanels].reverse(), ...(hovered ? [hovered] : [])]
    const panelArea = order
      .filter((p, i) => order.indexOf(p) === i && panels.includes(p) && (isOpen(p) || p === hovered))
      .map(p => panelBlock(p, isOpen(p)))
      .filter(block => block !== null)
    const rule = (key: string) => (
      <Text key={key} color={cfg.colors.rules}>
        {'─'.repeat(Math.max(1, e.props.bodyColumns))}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {panelArea.length > 0 ? rule('rule-top') : <Text key="top-gap"> </Text>}
        {panelArea}
        {panelArea.length > 0 ? rule('rule-bottom') : null}
        {lines.map((line, index) => {
          const segs: Seg[] = []
          line.forEach((part, i) => {
            if (i > 0) segs.push(sep)
            segs.push(...part)
          })
          const runs: Seg[][] = []
          for (const s of segs) {
            const last = runs[runs.length - 1]
            if (last && !s.menu && !last[0]?.menu && last[0]?.href === s.href) last.push(s)
            else runs.push([s])
          }
          return (
            <Box key={`line${index}`} flexDirection="row" flexWrap="wrap">
              {runs.map(run => {
                const first = run[0]
                if (first?.menu === 'harness' || first?.menu === 'effort' || first?.menu === 'model' || first?.menu === 'session') {
                  return menuControl(first)
                }
                if (first?.menu === 'project' && Client) {
                  return (
                    <Client
                      key="project-chip"
                      module="./chip.tsx"
                      props={{ text: first.text, color: first.color, look: 'link' }}
                    />
                  )
                }
                const texts = run.map(s => <Text color={s.color}>{s.text}</Text>)
                return first?.href ? <Link href={first.href}>{texts}</Link> : texts
              })}
            </Box>
          )
        })}
      </Box>
    )
  })
}
