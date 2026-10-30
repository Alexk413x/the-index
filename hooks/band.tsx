import { atom, read } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { IndexAgentStep, IndexPanel } from '../types'
import { EMPTY_TOTALS, MAIN, buildLines, cacheLeftMs, gitLinks, tint, type Config, type Seg, type ViewedAgent } from './lib/format'
import { PANELS, ROW_GAP, currentChoices, knownModels, mainStep, panelLines, rowOrder } from './lib/panels'
import { deviceTotal } from './lib/git'
import { agentColorKey } from './lib/agents'

// The validator reads an atom only in the file that declares it, so each file declares the atoms it uses.
const agents = atom({ plugin: 'the-index', key: 'agents' } as const, {})
const turn = atom({ plugin: 'the-index', key: 'turn' } as const, null)
const totals = atom({ plugin: 'the-index', key: 'totals' } as const, EMPTY_TOTALS)
const usage = atom({ plugin: 'the-index', key: 'usage' } as const, null)
const git = atom({ plugin: 'the-index', key: 'git' } as const, null)
const host = atom({ plugin: 'the-index', key: 'host' } as const, null)
const tick = atom({ plugin: 'the-index', key: 'tick' } as const, 0)
const clients = atom({ plugin: 'the-index', key: 'clients' } as const, {})
const agentEfforts = atom({ plugin: 'the-index', key: 'agentEfforts' } as const, {})
const agentModels = atom({ plugin: 'the-index', key: 'agentModels' } as const, {})
const seenModels = atom({ plugin: 'the-index', key: 'seenModels' } as const, {})
const pinned = atom({ plugin: 'the-index', key: 'pinned' } as const, [])
const slots = atom({ plugin: 'the-index', key: 'slots' } as const, [])
const hover = atom({ plugin: 'the-index', key: 'hover' } as const, null)
const harnesses = atom({ plugin: 'the-index', key: 'harnesses' } as const, null)
const ultracode = atom({ plugin: 'the-index', key: 'ultracode' } as const, false)
const agentColors = atom({ plugin: 'the-index', key: 'agentColors' } as const, {})
const usageSummary = atom({ plugin: 'the-index', key: 'usageSummary' } as const, null)
const contextLog = atom({ plugin: 'the-index', key: 'contextLog' } as const, [])
const contextLimit = atom({ plugin: 'the-index', key: 'contextLimit' } as const, null)
const contextSeries = atom({ plugin: 'the-index', key: 'contextSeries' } as const, null)
const baseCommits = atom({ plugin: 'the-index', key: 'baseCommits' } as const, [])
const branchCommits = atom({ plugin: 'the-index', key: 'branchCommits' } as const, [])
const mergedPrs = atom({ plugin: 'the-index', key: 'mergedPrs' } as const, [])
const turnHistory = atom({ plugin: 'the-index', key: 'turnHistory' } as const, [])
const basePrs = atom({ plugin: 'the-index', key: 'basePrs' } as const, [])
const worktrees = atom({ plugin: 'the-index', key: 'worktrees' } as const, [])
const deviceRepos = atom({ plugin: 'the-index', key: 'deviceRepos' } as const, [])
const swarm = atom({ plugin: 'the-index', key: 'swarm' } as const, null)

const PIN_ON = '■'
const PIN_OFF = '□'
const PIN_SPACE = ' '

export async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, cfg: Config): Promise<RenderElement | null> {
  if (e.props.hasSurvey) return null
  const table = $.ui.resolve(e)
  const Client = 'Client' in table ? table.Client : undefined
  if (!Client) return null
  const { Box, Text } = table

  const [agentSteps, liveTurn, sums, measured, repo, hostInfo, , remotes, efforts, models, seen, pinnedList, slotOrder, hovering, harnessList, ultracodeOn, colorOf, summary, contextPoints, limit, commits, branchLog, merged, prs, history, trees, device, series, swarmOn] =
    await Promise.all([
      read($, agents),
      read($, turn),
      read($, totals),
      read($, usage),
      read($, git),
      read($, host),
      read($, tick),
      read($, clients),
      read($, agentEfforts),
      read($, agentModels),
      read($, seenModels),
      read($, pinned),
      read($, slots),
      read($, hover),
      read($, harnesses),
      read($, ultracode),
      read($, agentColors),
      read($, usageSummary),
      read($, contextLog),
      read($, contextLimit),
      read($, baseCommits),
      read($, branchCommits),
      read($, mergedPrs),
      read($, basePrs),
      read($, turnHistory),
      read($, worktrees),
      read($, deviceRepos),
      read($, contextSeries),
      read($, swarm),
    ])
  const [now, liveModel, settings] = await Promise.all([$.clock.now(), $.session.model(), $.settings.read()])
  const steps: Readonly<Record<string, IndexAgentStep>> = { ...agentSteps, [MAIN]: mainStep(liveModel, agentSteps[MAIN], settings) }

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

  const agentColor = colorOf[viewed?.type ?? ''] ?? colorOf[hostInfo?.agent ?? '']
  const look = tint(cfg, agentColorKey(agentColor))
  const attached = Object.keys(remotes).length
  const lines = buildLines(
    {
      now,
      agents: steps,
      turn: liveTurn,
      totals: sums,
      usage: measured,
      git: repo,
      host: hostInfo,
      clients: attached,
      agentEfforts: efforts,
      agentModels: models,
      worktrees: deviceTotal(device),
      swarm: swarmOn,
    },
    look,
    viewed,
  )
  if (lines.length === 0) return null

  const target = viewed?.id ?? MAIN
  const view = {
    cfg: look,
    choices: currentChoices(target, steps[target], { model: models[target], effort: efforts[target] }, settings),
    harnesses: harnessList,
    modelIds: knownModels(seen, liveModel, settings),
    ultracode: ultracodeOn,
    contextTokens: measured?.contextTokens ?? null,
    host: hostInfo,
    agentColor,
    startedAt: measured?.startedAt ?? null,
    attached,
    turn: liveTurn,
    sessionCostUsd: measured?.costUsd ?? null,
    usage: summary,
    contextLog: contextPoints,
    contextLimit: limit,
    contextSeries: series,
    baseCommits: commits,
    baseRef: repo?.prBaseRef ?? '',
    branchCommits: branchLog,
    uncommitted:
      repo && repo.linesAdded + repo.linesRemoved + repo.filesAdded + repo.filesModified + repo.filesDeleted > 0
        ? { added: repo.linesAdded, removed: repo.linesRemoved, filesAdded: repo.filesAdded, filesModified: repo.filesModified, filesDeleted: repo.filesDeleted }
        : null,
    mergedPrs: merged,
    turnHistory: history,
    links: gitLinks(repo),
    basePrs: prs,
    worktrees: trees.map(t => (t.current ? { ...t, git: repo } : t)),
    deviceRepos: device,
    cacheLeftMs: cfg.show.cache ? cacheLeftMs(sums, cfg, now) : null,
    now,
  }
  const isPinned = (panel: IndexPanel) => pinnedList.includes(panel)

  const panelBlock = (panel: IndexPanel) => {
    const rows = panelLines(panel, view)
    if (rows.length === 0) return null
    const isPinnedRow = isPinned(panel)
    return (
      <Box key={`${panel}-block`} flexDirection="row" gap={1}>
        <Box flexDirection="column">
          <Client
            key={`${panel}-pin`}
            module="./clients/chip.tsx"
            props={{ text: isPinnedRow ? PIN_ON : PIN_OFF, color: look.colors.model }}
          />
          {rows.slice(1).map((_, i) => (
            <Text key={`${panel}-pin-space${i}`}>{PIN_SPACE}</Text>
          ))}
        </Box>
        <Client
          key={`${panel}-row`}
          module="./clients/row.tsx"
          props={{
            lines: rows,
            gap: ROW_GAP,
            hoverColor: look.colors.model,
            fade: true,
            closing: !isPinnedRow && hovering?.panel === panel && hovering.closing,
            target,
          }}
        />
      </Box>
    )
  }

  const shown = PANELS.filter(p => lines.flat(2).some(s => s.menu === p))
  const panelArea = rowOrder(slotOrder, pinnedList, hovering?.panel ?? null, shown)
    .map(panelBlock)
    .filter(block => block !== null)
  const rule = (key: string) => (
    <Box key={key} width="100%" overflow="hidden">
      <Text color={look.colors.rules} wrap="truncate">
        {'─'.repeat(Math.max(1, e.props.bodyColumns))}
      </Text>
    </Box>
  )
  const sep: Seg = { text: ' | ', color: look.colors.icons }

  const bandLines = lines.map((line, index) => {
    const segs: Seg[] = []
    line.forEach((part, i) => {
      if (i > 0) segs.push(sep)
      segs.push(...part)
    })
    const runs: Seg[][] = []
    for (const s of segs) {
      const last = runs[runs.length - 1]
      const head = last?.[0]
      const joins = s.menu ? head?.menu === s.menu : !head?.menu
      if (last && joins) last.push(s)
      else runs.push([s])
    }
    return (
      <Box key={`line${index}`} flexDirection="row" flexWrap="wrap">
        {runs.map(run => {
          const first = run[0]
          if (!first) return null
          const panel = PANELS.find(p => p === first.menu)
          if (panel === 'harness' && !harnessList) return <Text color={first.color}>{first.text}</Text>
          if (panel) {
            return (
              <Client
                key={`${panel}-chip`}
                module="./clients/chip.tsx"
                props={{
                  text: run.map(s => s.text).join(''),
                  color: first.color,
                  isActive: isPinned(panel),
                  ...(run.length > 1 ? { parts: run.map(s => ({ text: s.text, color: s.color })) } : {}),
                }}
              />
            )
          }
          if (first.menu === 'project' || first.menu === 'swarm') {
            return (
              <Client
                key={`${first.menu}-chip`}
                module="./clients/chip.tsx"
                props={{
                  text: run.map(s => s.text).join(''),
                  color: first.color,
                  look: 'link',
                  ...(run.length > 1 ? { parts: run.map(s => ({ text: s.text, color: s.color })) } : {}),
                }}
              />
            )
          }
          return run.map(s => <Text color={s.color}>{s.text}</Text>)
        })}
      </Box>
    )
  })
  const rows = panelArea.length > 0 ? [rule('rule-top'), ...panelArea, rule('rule-bottom')] : []
  // The desktop app grows the band downward, so rows opened above the lines would push the
  // hovered name away from the pointer; there they open below the lines instead.
  return e.surface === 'desktop' ? (
    <Box flexDirection="column">
      {bandLines}
      {rows}
    </Box>
  ) : (
    <Box flexDirection="column">
      {rows.length ? rows : <Text key="top-gap"> </Text>}
      {bandLines}
    </Box>
  )
}
