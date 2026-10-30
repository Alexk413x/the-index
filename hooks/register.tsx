import type { Register } from 'claude-code'

import type { IndexEffort } from '../types'
import { readConfig } from './lib/format'
import { EFFORTS } from './lib/panels'
import { isUserPrompt, type DETAIL_PANE as PANE_ID } from './lib/detail'
import { renderBand } from './band'
import { attachClient, detachClient, loadHarnesses, notePromptTitle, refreshHost, refreshLinkUntilLinked, refreshSwarm } from './host'
import { countPrompt, detailClosed, onPaneMessage, renderDetail } from './pane'
import { forgetPrs, pollRepo, refreshDevice, refreshGit, refreshGitSoon, refreshWorktrees, refreshWorktreesSoon, resolveGitDirs, stampRepo } from './repo'
import { chooseStep, clearUltracode, followModel, onBandMessage, placeSlot, setMainEffort, setPinned, settleStep, syncUltracode } from './rows'
import {
  countCompaction,
  flushLedger,
  recordCall,
  recordEdit,
  recordTurn,
  recordUsage,
  refreshCompactThreshold,
  scheduleTick,
  seedLedgerCost,
  setCacheTtl,
  startCall,
  startSessionShare,
  syncLedger,
} from './usage'

const GIT_STAT_EVERY_MS = 10_000
const GIT_LOCAL_EVERY_MS = 60_000
const GIT_FULL_EVERY_MS = 300_000
const HOST_MIN_GAP_MS = 300_000
const PR_COMMAND = /\b(gh\s+pr|git\s+push)\b/
// The validator reads a matcher's value only from a const in this file, so the pane id is repeated here.
const DETAIL_PANE: typeof PANE_ID = 'the-index-detail'

let hostAt = 0

export const register: Register = (on, options) => {
  const cfg = readConfig(options)
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'index-effort', description: "Open the band's effort row" })
    await resolveGitDirs($, await $.session.cwd())
    await Promise.allSettled([
      refreshHost($),
      refreshGit($),
      refreshWorktrees($),
      loadHarnesses($),
      seedLedgerCost($),
      syncLedger($),
      refreshCompactThreshold($),
      $.session.usage().then(u => recordUsage($, u)),
      refreshSwarm($),
    ])
    hostAt = await $.clock.now()
    await stampRepo($)
    scheduleTick($, cfg)
    $.clock.every(GIT_STAT_EVERY_MS, () => {
      pollRepo($)
    })
    // Edits made outside the session (an IDE, another terminal) touch no file in .git.
    $.clock.every(GIT_LOCAL_EVERY_MS, () => {
      refreshGitSoon($)
      void refreshDevice($)
      void refreshLinkUntilLinked($)
      void refreshSwarm($)
    })
    $.clock.every(GIT_FULL_EVERY_MS, () => {
      refreshWorktreesSoon($)
      void syncLedger($)
      void refreshCompactThreshold($)
    })
    return result
  })

  on('ui.message', { component: 'AbovePrompt' }, async ($, e) => onBandMessage($, e))

  on('ui.message', { component: 'Pane' }, async ($, e) => onPaneMessage($, e))

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === DETAIL_PANE) await detailClosed($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: DETAIL_PANE }, async ($, e, next) => (await renderDetail($, e, cfg)) ?? next(e))

  on('command.run', { command: 'index-effort' }, async $ => {
    await setPinned($, 'effort', true)
    await placeSlot($, 'effort')
    return { text: 'The effort row is open above the band. To set a level directly, run /effort.' }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await flushLedger($)
    const result = await next(e)
    if (e.reason === 'clear') await startSessionShare($)
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.messages !== undefined) await countCompaction($, e.trigger)
    return result
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    void refreshCompactThreshold($)
    const ttlMs = e.cache_ttl === '5m' ? 300_000 : 3_600_000
    await followModel($, e.to_model)
    await setCacheTtl($, ttlMs)
    return result
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const arg = e.args.trim().toLowerCase()
    const level: IndexEffort | undefined = arg === 'auto' ? 'auto' : EFFORTS.find(l => l === arg)
    if (level) await setMainEffort($, level)
    return result
  })

  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    await syncUltracode($, result.text)
    return result
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    await notePromptTitle($, e.session_title)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    await clearUltracode($)
    if (!result.drop && isUserPrompt(e.origin.kind, e.isMeta)) await countPrompt($)
    return result
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (e.surface !== 'terminal') await attachClient($, e.clientId, e.surface)
    return result
  })

  on('session.detach', async ($, e, next) => {
    const result = await next(e)
    await detachClient($, e.clientId)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await recordUsage($, e)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const step = await chooseStep($, e)
    const start = await startCall($, e)
    const result = yield* next(step.sent)
    await settleStep($, e, step, result)
    await recordCall($, cfg, e, result, start)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    if ((e.tool === 'Edit' || e.tool === 'Write') && !r.isError) {
      const path: unknown = e.file_path
      await recordEdit($, r.result, e.agentId === undefined, typeof path === 'string' ? path : undefined)
    }
    if (e.tool === 'Bash' && typeof e.command === 'string' && PR_COMMAND.test(e.command)) forgetPrs()
    if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'Bash') refreshGitSoon($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await recordTurn($, e.turnId)
    refreshGitSoon($)
    const now = await $.clock.now()
    if (now - hostAt >= HOST_MIN_GAP_MS) {
      hostAt = now
      void refreshHost($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (await renderBand($, e, cfg)) ?? next(e))
}
