import { atom, read, update } from 'claude-code'
import type { EngineInterface, ToolCallArgs } from 'claude-code'

import type { IndexHarness, IndexSwarm } from '../types'
import { normPath, projectName, swarmRunning } from './lib/format'
import { transcriptTitle } from './lib/panels'
import { isRecord, parseJson } from './lib/git'
import { parseAgentFile } from './lib/agents'

// The validator reads an atom only in the file that declares it, so each file declares the atoms it uses.
const host = atom({ plugin: 'the-index', key: 'host' } as const, null)
const clients = atom({ plugin: 'the-index', key: 'clients' } as const, {})
const harnesses = atom({ plugin: 'the-index', key: 'harnesses' } as const, null)
const agentColors = atom({ plugin: 'the-index', key: 'agentColors' } as const, {})
const swarm = atom({ plugin: 'the-index', key: 'swarm' } as const, null)

const AGENT_TABS = 'plugin:ide-agent-tabs:ide-agent-tabs'
const MESSAGES_TOOL: string = 'mcp__ide-agent-tabs__open_agent_messages'
const SWARM_STATUS_TOOL: string = 'mcp__sentinel-swarm__swarm_status'
const SWARM_PANEL_TOOL: string = 'mcp__sentinel-swarm__open_panel'

export async function readJson($: EngineInterface, path: string): Promise<unknown> {
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

export async function tempDir($: EngineInterface): Promise<string> {
  const dir = (await $.env.get('TEMP')) || (await $.env.get('TMP')) || (await $.env.get('TMPDIR')) || '/tmp'
  return dir.replace(/[\\/]+$/, '')
}

export async function configDir($: EngineInterface): Promise<string> {
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
  if (otherSessions.id !== sessionId) otherSessions = { id: sessionId, files: new Set() }
  const listed = async () => (await listNames($, `${dir}/sessions`)).filter(name => name !== ownSessionFile)
  for (const name of [...(ownSessionFile ? [ownSessionFile] : []), ...(await listed())]) {
    if (!name.endsWith('.json') || otherSessions.files.has(name)) continue
    const entry = await readJson($, `${dir}/sessions/${name}`)
    if (isRecord(entry) && entry['sessionId'] === sessionId) {
      ownSessionFile = name
      const bridgeId = typeof entry['bridgeSessionId'] === 'string' ? entry['bridgeSessionId'] : ''
      return { name: String(entry['name'] ?? ''), bridged: bridgeId !== '', bridgeId }
    }
    if (isRecord(entry)) otherSessions.files.add(name)
  }
  ownSessionFile = ''
  return { name: '', bridged: false, bridgeId: '' }
}

let ownSessionFile = ''
let otherSessions = { id: '', files: new Set<string>() }

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

export async function refreshHost($: EngineInterface): Promise<void> {
  const [cwd, id, settings, dir, version] = await Promise.all([
    $.session.cwd(),
    $.session.id(),
    $.settings.read(),
    configDir($),
    $.session.version(),
  ])
  const [entry, ide, tools, title] = await Promise.all([
    sessionEntry($, dir, id),
    detectIde($, dir, cwd),
    $.tool.list().catch(() => []),
    sessionTitle($),
    loadAgentColors($),
  ])
  const agentSetting = settings['agent']
  await update($, host, () => ({
    sessionName: entry.name,
    sessionId: id,
    bridged: entry.bridged,
    bridgeId: entry.bridgeId,
    cwd,
    version: version.version,
    ide,
    agent: typeof agentSetting === 'string' ? agentSetting : '',
    project: projectName(cwd),
    messages: tools.some(t => t.name === MESSAGES_TOOL),
    title,
  }))
}

// Windows: the shell's Open brings the window to the front (explorer.exe opens it behind the
// focused app). The target travels in an environment variable, never inside the -Command
// script, so quotes in a path or URL can't end the string and run code.
async function shellOpen($: EngineInterface, target: string): Promise<void> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const openers: [readonly string[], Record<string, string>?][] = isWindows
    ? [[['powershell', '-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Shell.Application).Open($env:THE_INDEX_OPEN)'], { THE_INDEX_OPEN: target }]]
    : // macOS has `open`; Linux has xdg-open, and its `open` (openvt) exits non-zero, so each is tried in turn.
      [[['open', target]], [['xdg-open', target]]]
  for (const [argv, env] of openers) {
    try {
      const r = await $.process.run(argv, env ? { timeoutMs: 10_000, env } : { timeoutMs: 10_000 })
      if (r.exitCode === 0) return
    } catch {
      continue
    }
  }
  $.ui.toast(`Could not open ${target}`)
}

export async function openUrl($: EngineInterface, href: string): Promise<void> {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return
  }
  if (url.protocol === 'https:') await shellOpen($, url.href)
}

export async function openFolder($: EngineInterface, path?: string): Promise<void> {
  const dir = path ?? (await $.session.cwd())
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  await shellOpen($, isWindows ? dir.replace(/\//g, '\\') : dir)
}

async function loadAgentColors($: EngineInterface): Promise<void> {
  const [cwd, dir] = await Promise.all([$.session.cwd(), configDir($)])
  const found: Record<string, string> = {}
  for (const agentsDir of [`${dir}/agents`, `${cwd.replace(/[\\/]+$/, '')}/.claude/agents`]) {
    for (const name of await listNames($, agentsDir)) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const text = await $.fs.read(`${agentsDir}/${name}`).catch(() => '')
      const agent = parseAgentFile(text, name)
      if (agent?.color) found[agent.name] = agent.color
      else if (agent) delete found[agent.name]
    }
  }
  const before = await read($, agentColors)
  if (JSON.stringify(before) !== JSON.stringify(found)) await update($, agentColors, () => found)
}

export async function refreshLinkUntilLinked($: EngineInterface): Promise<void> {
  const current = await read($, host)
  if (!current || current.bridged) return
  const [dir, id] = await Promise.all([configDir($), $.session.id()])
  const entry = await sessionEntry($, dir, id)
  if (!entry.bridged && entry.name === current.sessionName) return
  await update($, host, prev => (prev ? { ...prev, sessionName: entry.name, bridged: entry.bridged, bridgeId: entry.bridgeId } : prev))
}

function mcpJson(result: unknown): unknown {
  if (!isRecord(result) || result['isError'] === true || !Array.isArray(result['content'])) return undefined
  const first: unknown = result['content'][0]
  return isRecord(first) && typeof first['text'] === 'string' ? parseJson(first['text']) : undefined
}

export async function loadHarnesses($: EngineInterface): Promise<void> {
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

export async function openHarness($: EngineInterface, name: string): Promise<void> {
  const label = (await read($, harnesses))?.find(h => h.name === name)?.label ?? name
  try {
    const result = await $.mcp.call(AGENT_TABS, 'open_tab', { agent: name, path: await $.session.cwd() })
    $.ui.toast(isRecord(result) && result['isError'] === true ? `Could not open ${label}` : `Opened ${label} in a new tab`)
  } catch {
    $.ui.toast(`Could not open ${label}: agent tabs is not available`)
  }
}

// The transcript is the CLI's own file, not part of the mod API: the remote title is its
// last `ai-title` entry, or a `custom-title` one after a rename.
// $.fs.read refuses a file over 4 MiB, so a long transcript falls back to the title the last prompt carried.
async function sessionTitle($: EngineInterface): Promise<string> {
  try {
    const [dir, root, id] = await Promise.all([configDir($), $.session.root(), $.session.id()])
    const path = `${dir}/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
    const st = await $.fs.stat(path)
    if (st.size > TRANSCRIPT_READ_MAX) return promptTitle
    if (path !== titleRead.path || st.mtimeMs !== titleRead.mtimeMs) {
      titleRead = { path, mtimeMs: st.mtimeMs, title: transcriptTitle(await $.fs.read(path)) }
    }
    return titleRead.title || promptTitle
  } catch {
    return promptTitle
  }
}

const TRANSCRIPT_READ_MAX = 4 * 1024 * 1024
let titleRead = { path: '', mtimeMs: -1, title: '' }
let promptTitle = ''

export async function notePromptTitle($: EngineInterface, title: string | undefined): Promise<void> {
  if (!title || title === promptTitle) return
  promptTitle = title
  const shown = await sessionTitle($)
  await update($, host, prev => (prev && prev.title !== shown ? { ...prev, title: shown } : prev))
}

export async function refreshSessionRow($: EngineInterface): Promise<void> {
  const [tools, title] = await Promise.all([$.tool.list().catch(() => []), sessionTitle($)])
  const messages = tools.some(t => t.name === MESSAGES_TOOL)
  await update($, host, prev => (prev && (prev.messages !== messages || prev.title !== title) ? { ...prev, messages, title } : prev))
}

export async function openMessages($: EngineInterface): Promise<void> {
  try {
    // The generated types list only the tools known when they were written; Agent Tabs registers this one at runtime.
    const { text } = await $.tool.call({ tool: MESSAGES_TOOL } as ToolCallArgs)
    if (text) $.ui.toast(text)
  } catch {
    $.ui.toast('Could not open Messages: agent tabs is not available')
  }
}

export async function refreshSwarm($: EngineInterface): Promise<void> {
  const tools = await $.tool.list().catch(() => [])
  let state: IndexSwarm | null = null
  if (tools.some(t => t.name === SWARM_STATUS_TOOL)) {
    try {
      // sentinel-swarm registers its tools at runtime, so the generated types don't list them.
      state = swarmRunning(await $.tool.call({ tool: SWARM_STATUS_TOOL, repo: await $.session.cwd() } as ToolCallArgs)) ? 'running' : 'idle'
    } catch {
      state = 'idle'
    }
  }
  if (state !== (await read($, swarm))) await update($, swarm, () => state)
}

export async function openSwarm($: EngineInterface): Promise<void> {
  let failed: boolean
  try {
    const result = await $.tool.call({ tool: SWARM_PANEL_TOOL, repo: await $.session.cwd() } as ToolCallArgs)
    failed = result.isError === true || typeof result.deny === 'string'
  } catch {
    failed = true
  }
  if (failed) $.ui.toast('Could not open the swarm panel: sentinel-swarm is not available')
}

export async function attachClient($: EngineInterface, clientId: string, surface: string): Promise<void> {
  await update($, clients, prev => ({ ...prev, [clientId]: surface }))
}

export async function detachClient($: EngineInterface, clientId: string): Promise<void> {
  await update($, clients, prev => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== clientId)))
}
