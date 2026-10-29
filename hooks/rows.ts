import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer, TurnStepInput, TurnStepResult, UiMessageArgument, UiMessageResult } from 'claude-code'

import type { IndexEffort, IndexPanel } from '../types'
import { MAIN, MODEL_FAMILIES, learnModels, modelLabel } from './lib/format'
import { CONTEXT_PICK, DETAIL_PICK, EFFORTS, FOLDER_PICK, MESSAGES_PICK, PANELS, knownModels, savedEffortFor, worktreePaths } from './lib/panels'
import { isRecord, samePath } from './lib/git'
import { openFolder, openHarness, openMessages, openSwarm, openUrl, refreshSessionRow } from './host'
import { refreshDevice, refreshWorktreesSoon } from './repo'
import { toggleDetail } from './pane'

// The validator reads an atom only in the file that declares it, so each file declares the atoms it uses.
const agents = atom({ plugin: 'the-index', key: 'agents' } as const, {})
const host = atom({ plugin: 'the-index', key: 'host' } as const, null)
const agentEfforts = atom({ plugin: 'the-index', key: 'agentEfforts' } as const, {})
const agentModels = atom({ plugin: 'the-index', key: 'agentModels' } as const, {})
const seenModels = atom({ plugin: 'the-index', key: 'seenModels' } as const, {})
const pinned = atom({ plugin: 'the-index', key: 'pinned' } as const, [])
const slots = atom({ plugin: 'the-index', key: 'slots' } as const, [])
const hover = atom({ plugin: 'the-index', key: 'hover' } as const, null)
const ultracode = atom({ plugin: 'the-index', key: 'ultracode' } as const, false)
const contextSeries = atom({ plugin: 'the-index', key: 'contextSeries' } as const, null)
const worktrees = atom({ plugin: 'the-index', key: 'worktrees' } as const, [])
const deviceRepos = atom({ plugin: 'the-index', key: 'deviceRepos' } as const, [])

const ULTRACODE = /\bultracode\b/i

function commandText(result: unknown): string {
  return typeof result === 'object' && result !== null && 'text' in result ? String(result.text ?? '') : ''
}

async function switchMainModel($: EngineInterface, alias: string): Promise<void> {
  const text = commandText(await $.command.run({ command: 'model', args: alias }))
  if (text) $.ui.toast(text.replace(/`/g, ''))
  const model = await $.session.model().catch(() => '')
  if (model) await followModel($, model)
}

async function seeModels($: EngineInterface, ids: readonly unknown[]): Promise<void> {
  await update($, seenModels, prev => {
    const next = learnModels(prev, ids)
    return Object.keys(next).some(k => next[k] !== prev[k]) ? next : prev
  })
}

export async function followModel($: EngineInterface, model: string): Promise<void> {
  await seeModels($, [model])
  const effort = savedEffortFor(await $.settings.read(), model)
  await update($, agents, prev => ({ ...prev, [MAIN]: { model, effort: effort ?? prev[MAIN]?.effort } }))
}

async function switchMainEffort($: EngineInterface, level: IndexEffort | 'auto'): Promise<void> {
  const result = await $.command.run({ command: 'effort', args: String(level) })
  const text = commandText(result)
  if (text) $.ui.toast((text.split(':')[0] ?? text).replace(/`/g, ''))
  await update($, agents, prev => ({ ...prev, [MAIN]: { model: prev[MAIN]?.model ?? '', effort: level } }))
}

export function setPinned($: EngineInterface, panel: IndexPanel, isPinned: boolean): Promise<unknown> {
  return update($, pinned, list => {
    const rest = list.filter(p => p !== panel)
    return isPinned ? [...rest, panel] : rest
  })
}

const HOVER_OPEN_MS = 300
const HOVER_CLOSE_MS = 300
const FADE_OUT_FALLBACK_MS = 1000
let hoverTimer: Timer | undefined
const pointerOver = new Set<string>()

function forgetPointer(panel: IndexPanel): void {
  for (const key of [...pointerOver]) if (key.startsWith(`${panel}-`)) pointerOver.delete(key)
}

// A row taken off the band never posts its leave, so its pointer keys would keep the panel open.
function forgetRow(panel: IndexPanel): void {
  pointerOver.delete(`${panel}-row`)
  pointerOver.delete(`${panel}-pin`)
}

export async function placeSlot($: EngineInterface, panel: IndexPanel): Promise<void> {
  if (panel === 'worktrees') {
    refreshWorktreesSoon($)
    void refreshDevice($)
  }
  const pinnedList = await read($, pinned)
  await update($, slots, list => {
    const live = list.filter(p => p === panel || pinnedList.includes(p))
    for (const p of list) if (!live.includes(p)) forgetRow(p)
    return live.includes(panel) ? live : [...live, panel]
  })
}

function dropSlot($: EngineInterface, panel: IndexPanel): Promise<unknown> {
  forgetRow(panel)
  return update($, slots, list => list.filter(p => p !== panel))
}

function hoverOpenSoon($: EngineInterface, panel: IndexPanel): void {
  hoverTimer?.cancel()
  hoverTimer = $.clock.after(HOVER_OPEN_MS, () => {
    void placeSlot($, panel).then(() => update($, hover, () => ({ panel, closing: false })))
  })
}

async function hoverKeep($: EngineInterface, panel: IndexPanel): Promise<void> {
  const h = await read($, hover)
  if (h && h.panel !== panel) return
  hoverTimer?.cancel()
  if (h?.closing) await update($, hover, () => ({ ...h, closing: false }))
}

function hoverCloseSoon($: EngineInterface): void {
  hoverTimer?.cancel()
  hoverTimer = $.clock.after(HOVER_CLOSE_MS, () => {
    void update($, hover, h => (h && !h.closing ? { ...h, closing: true } : h))
    hoverTimer = $.clock.after(FADE_OUT_FALLBACK_MS, () => {
      void hoverClose($)
    })
  })
}

async function hoverClose($: EngineInterface): Promise<void> {
  hoverTimer?.cancel()
  const [closing, pinnedList] = await Promise.all([read($, hover), read($, pinned)])
  await update($, hover, () => null)
  if (closing && !pinnedList.includes(closing.panel)) await dropSlot($, closing.panel)
}

async function togglePin($: EngineInterface, panel: IndexPanel): Promise<void> {
  hoverTimer?.cancel()
  const wasPinned = (await read($, pinned)).includes(panel)
  await setPinned($, panel, !wasPinned)
  if (!wasPinned) {
    await placeSlot($, panel)
  } else if ([...pointerOver].some(key => key.startsWith(`${panel}-`))) {
    await update($, hover, () => ({ panel, closing: false }))
  } else {
    await dropSlot($, panel)
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
  if (panel === 'context') {
    if (pick === DETAIL_PICK) await toggleDetail($)
    else if (pick.startsWith(CONTEXT_PICK)) await update($, contextSeries, () => pick.slice(CONTEXT_PICK.length) || null)
    return
  }
  if (panel === 'branch' || panel === 'base') {
    await openUrl($, pick)
    return
  }
  if (panel === 'worktrees') {
    const path = pick.startsWith(FOLDER_PICK) ? pick.slice(FOLDER_PICK.length) : ''
    if (!path) await openUrl($, pick)
    else if (worktreePaths({ worktrees: await read($, worktrees), deviceRepos: await read($, deviceRepos) }).some(p => samePath(p, path))) {
      await openFolder($, path)
    }
    return
  }
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
      await update($, agentEfforts, prev => {
        const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== target))
        return level ? { ...rest, [target]: level } : rest
      })
    }
  } else if (panel === 'model') {
    const family = MODEL_FAMILIES.find(f => f === pick)
    if (!family && pick !== 'default') return
    if (target === MAIN) await switchMainModel($, family ?? 'default')
    else {
      const [seen, liveModel, settings] = await Promise.all([read($, seenModels), $.session.model(), $.settings.read()])
      const id = family ? (knownModels(seen, liveModel, settings)[family] ?? family) : undefined
      await update($, agentModels, prev => {
        const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== target))
        return id ? { ...rest, [target]: id } : rest
      })
    }
  } else {
    return
  }
  hoverTimer?.cancel()
  forgetPointer(panel)
  await setPinned($, panel, false)
  await Promise.all([update($, hover, () => null), dropSlot($, panel)])
}

export async function setMainEffort($: EngineInterface, level: IndexEffort): Promise<void> {
  await update($, agents, prev => ({ ...prev, [MAIN]: { model: prev[MAIN]?.model ?? '', effort: level } }))
}

export async function syncUltracode($: EngineInterface, text: string): Promise<void> {
  const isOn = ULTRACODE.test(text)
  if (isOn !== (await read($, ultracode))) await update($, ultracode, () => isOn)
}

export async function clearUltracode($: EngineInterface): Promise<void> {
  if (await read($, ultracode)) await update($, ultracode, () => false)
}

export async function chooseStep($: EngineInterface, e: TurnStepInput) {
  const key = e.agentId ?? MAIN
  const [chosenEfforts, chosenModels] = await Promise.all([read($, agentEfforts), read($, agentModels)])
  const chosen = chosenEfforts[key]
  const chosenModel = chosenModels[key]
  const effort = chosen ?? e.effort
  const model = chosenModel ?? e.model
  await update($, agents, prev => ({ ...prev, [key]: { model, effort } }))
  const sent = chosen === undefined && chosenModel === undefined ? e : { ...e, model, effort }
  return { key, effort, chosenModel, sent }
}

type StepChoice = Awaited<ReturnType<typeof chooseStep>>

export async function settleStep($: EngineInterface, e: TurnStepInput, step: StepChoice, result: TurnStepResult): Promise<void> {
  const { key, effort, chosenModel } = step
  const answeredBy = result.usage?.model
  await seeModels($, [e.model, answeredBy])
  const shown = (await read($, agents))[key]
  if (answeredBy && (shown?.model !== answeredBy || shown.effort !== effort)) await update($, agents, prev => ({ ...prev, [key]: { model: answeredBy, effort } }))
  if (chosenModel !== undefined && result.stopReason === null && !result.usage) {
    await update($, agentModels, prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))
    await update($, agents, prev => ({ ...prev, [key]: { model: e.model, effort } }))
    $.ui.toast(`${modelLabel(chosenModel)} did not answer, so the band went back to the session's model.`)
  }
}

export async function onBandMessage($: EngineInterface, e: UiMessageArgument): Promise<UiMessageResult> {
  const data = isRecord(e.data) ? e.data : {}
  if (e.element === 'project-chip') {
    if (data['press'] === true) await openFolder($)
    return {}
  }
  if (e.element === 'swarm-chip') {
    if (data['press'] === true) await openSwarm($)
    return {}
  }
  const panel = PANELS.find(p => e.element.startsWith(`${p}-`))
  if (!panel) return {}
  const isName = e.element === `${panel}-chip`
  if (panel === 'session' && isName && (data['hover'] === true || data['press'] === true)) await refreshSessionRow($)
  if (data['hover'] === true) {
    pointerOver.add(e.element)
    if (isName && (await read($, hover))?.panel !== panel) hoverOpenSoon($, panel)
    else await hoverKeep($, panel)
  } else if (data['hover'] === false) {
    pointerOver.delete(e.element)
    if (![...pointerOver].some(key => key.startsWith(`${panel}-`))) hoverCloseSoon($)
  } else if (data['press'] === true && (isName || e.element === `${panel}-pin`)) {
    await togglePin($, panel)
  } else if (data['faded'] === true && e.element === `${panel}-row`) {
    const h = await read($, hover)
    if (h?.closing && h.panel === panel) await hoverClose($)
  } else if (panel === 'session' && data['pick'] === 'name' && e.element === `${panel}-row`) {
    const name = (await read($, host))?.sessionName
    if (name) {
      const copied = await $.ui.copy({ text: name, surface: e.surface })
      $.ui.toast(copied.isCopied ? `Copied: ${name}` : `Could not copy ${name}: ${copied.reason}`)
    }
  } else if (panel === 'session' && data['pick'] === MESSAGES_PICK && e.element === `${panel}-row`) {
    await openMessages($)
  } else if (typeof data['pick'] === 'string' && e.element === `${panel}-row`) {
    await applyPick($, panel, typeof data['target'] === 'string' ? data['target'] : MAIN, data['pick'])
  }
  return {}
}
