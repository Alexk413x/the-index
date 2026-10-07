import { describe, expect, test } from 'claude-code/testing'

import { MAIN, readConfig } from '../hooks/format'
import { emptyGit } from '../hooks/git'
import {
  MIDDLE_WIDTH,
  ROW_GAP,
  TITLE_WIDTH,
  FOLDER_PICK,
  currentChoices,
  mainStep,
  padTo,
  panelLines,
  rowOrder,
  savedEffortFor,
  sectionWidth,
  type PanelView,
  type RowItem,
} from '../hooks/panels'

const SETTINGS = {
  effortLevel: 'low',
  modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'xhigh' }, 'claude-haiku-4-5-20251001': {} },
}
const HOST = { sessionName: 'peer', sessionId: 'abc', bridged: false, cwd: 'C:/work/app', version: '2.1.288', ide: '', agent: '', project: 'app' }

function view(over: Partial<PanelView> = {}): PanelView {
  return {
    cfg: readConfig({}),
    choices: { model: 'claude-opus-5-5', effort: 'high', modelIsDefault: true, effortIsDefault: false },
    harnesses: null,
    ultracode: false,
    contextTokens: null,
    host: HOST,
    startedAt: null,
    attached: 0,
    turn: null,
    sessionCostUsd: null,
    usage: null,
    contextLog: [],
    contextLimit: null,
    baseCommits: [],
    baseRef: 'origin/main',
    branchCommits: [],
    uncommitted: null,
    mergedPrs: [],
    turnHistory: [],
    links: {},
    basePrs: [],
    cacheLeftMs: null,
    now: 0,
    ...over,
  }
}

function starts(line: readonly RowItem[]): number[] {
  const cols: number[] = []
  let col = 0
  for (const item of line) {
    cols.push(col)
    col += item.text.length + (item.pad ?? 0) + ROW_GAP
  }
  return cols
}

describe('saved effort', () => {
  test('the model entry wins, then the global level, and 1M ids share their model entry', () => {
    expect(savedEffortFor(SETTINGS, 'claude-sonnet-5-5')).toBe('xhigh')
    expect(savedEffortFor(SETTINGS, 'claude-sonnet-5-5[1m]')).toBe('xhigh')
    expect(savedEffortFor(SETTINGS, 'claude-haiku-4-5-20251001')).toBe('low')
    expect(savedEffortFor(SETTINGS, 'claude-opus-5-5')).toBe('low')
  })

  test('auto and unknown values are no saved level', () => {
    expect(savedEffortFor({ effortLevel: 'auto' }, 'claude-opus-5-5')).toBeUndefined()
    expect(savedEffortFor({ effortLevel: 'turbo' }, 'claude-opus-5-5')).toBeUndefined()
    expect(savedEffortFor({}, 'claude-opus-5-5')).toBeUndefined()
  })
})

describe('main step', () => {
  test('the live model wins over the last request, and the effort falls back to the saved one', () => {
    expect(mainStep('claude-sonnet-5-5', { model: 'claude-opus-5-5' }, SETTINGS)).toEqual({ model: 'claude-sonnet-5-5', effort: 'xhigh' })
    expect(mainStep('claude-sonnet-5-5', { model: 'claude-opus-5-5', effort: 'max' }, SETTINGS)).toEqual({
      model: 'claude-sonnet-5-5',
      effort: 'max',
    })
    expect(mainStep('', { model: 'claude-opus-5-5' }, {})).toEqual({ model: 'claude-opus-5-5', effort: undefined })
  })
})

describe('current choices', () => {
  test('the main session is on default when nothing is saved or effort is auto', () => {
    expect(currentChoices(MAIN, { model: 'claude-opus-5-5', effort: 'high' }, {}, {})).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high',
      modelIsDefault: true,
      effortIsDefault: true,
    })
    const saved = { model: 'sonnet', ...SETTINGS }
    expect(currentChoices(MAIN, { model: 'claude-sonnet-5-5[1m]', effort: 'xhigh' }, {}, saved)).toMatchObject({
      model: 'claude-sonnet-5-5',
      modelIsDefault: false,
      effortIsDefault: false,
    })
    expect(currentChoices(MAIN, { model: 'claude-sonnet-5-5', effort: 'auto' }, {}, saved).effortIsDefault).toBe(true)
  })

  test('a subagent is on default until the band picks for it', () => {
    const step = { model: 'claude-sonnet-5-5', effort: 'low' as const }
    expect(currentChoices('a1', step, {}, SETTINGS)).toEqual({
      model: 'claude-sonnet-5-5',
      effort: 'low',
      modelIsDefault: true,
      effortIsDefault: true,
    })
    expect(currentChoices('a1', step, { model: 'claude-fable-5-1', effort: 'max' }, SETTINGS)).toEqual({
      model: 'claude-fable-5-1',
      effort: 'max',
      modelIsDefault: false,
      effortIsDefault: false,
    })
  })
})

describe('row layout', () => {
  test('padTo pads the last item out to the width, never below it', () => {
    const items = [
      { text: 'ab', color: '#000000' },
      { text: 'cd', color: '#000000' },
    ]
    expect(sectionWidth(items)).toBe(2 + ROW_GAP + 2)
    expect(sectionWidth(padTo(items, 20))).toBe(20)
    expect(padTo(items, 1).map(i => i.pad ?? 0)).toEqual([0, 0])
    expect(padTo([], 10)).toEqual([])
  })

  test('effort and model rows put default and the note in the same columns', () => {
    const effort = panelLines('effort', view())[0] ?? []
    const model = panelLines('model', view())[0] ?? []
    const column = (line: readonly RowItem[], text: string) => starts(line)[line.findIndex(i => i.text === text)]
    const defaultAt = TITLE_WIDTH + ROW_GAP + MIDDLE_WIDTH - 'default'.length
    expect(column(effort, 'default')).toBe(defaultAt)
    expect(column(model, 'default')).toBe(defaultAt)
    expect(starts(effort)[effort.length - 1]).toBe(TITLE_WIDTH + ROW_GAP + MIDDLE_WIDTH + ROW_GAP)
    expect(starts(model)[model.length - 1]).toBe(TITLE_WIDTH + ROW_GAP + MIDDLE_WIDTH + ROW_GAP)
  })

  test('the current choice is lit and not a pick; default is a pick only when off default', () => {
    const effort = panelLines('effort', view())[0] ?? []
    const cfg = readConfig({})
    expect(effort.find(i => i.text === 'high')).toEqual({ text: 'high', color: cfg.colors.model })
    expect(effort.find(i => i.text === 'low')?.pick).toBe('low')
    expect(effort.find(i => i.text === 'default')?.pick).toBe('default')
    const model = panelLines('model', view())[0] ?? []
    expect(model.filter(i => i.pick).map(i => i.pick)).toEqual(['fable', 'sonnet', 'haiku'])
  })

  test('ultracode lights while the keyword is in the draft', () => {
    const cfg = readConfig({})
    const off = panelLines('effort', view())[0]?.find(i => i.text === 'ultracode')
    const on = panelLines('effort', view({ ultracode: true }))[0]?.find(i => i.text === 'ultracode')
    expect(off).toMatchObject({ color: cfg.colors.icons, pick: 'ultracode' })
    expect(on).toMatchObject({ color: cfg.colors.model, pick: 'ultracode' })
  })

  test('the re-cache note names the context size when known', () => {
    const last = (v: PanelView) => (panelLines('model', v)[0] ?? []).at(-1)?.text
    expect(last(view())).toBe('may re-cache the conversation')
    expect(last(view({ contextTokens: 24_000 }))).toBe('may re-cache about 24k tokens')
  })

  test('the harness row lists agent tabs harnesses, and is empty without them', () => {
    expect(panelLines('harness', view())).toEqual([])
    const line = panelLines('harness', view({ harnesses: [{ name: 'codex', label: 'Codex' }] }))[0] ?? []
    expect(line.map(i => i.text)).toEqual(['Open', 'Codex', 'in a new tab'])
    expect(line[1]?.pick).toBe('codex')
  })

  test('the session table adds a Remote row only when linked, and lines up its third column', () => {
    const plain = panelLines('session', view({ startedAt: new Date(2026, 9, 4, 9, 5).getTime() }))
    expect(plain.map(l => l[0]?.text)).toEqual(['Session', 'Agent', 'Folder'])
    expect(plain[1]?.map(i => i.text.trim())).toEqual(['Agent', 'none'])
    expect(plain[0]?.at(-1)?.text).toBe('started 09:05')
    expect(plain[0]?.find(i => i.pick === 'name')).toMatchObject({ text: expect.stringContaining(HOST.sessionName), link: true })
    const linked = panelLines(
      'session',
      view({ host: { ...HOST, agent: 'reviewer', bridged: true, bridgeId: 'cse_1' }, agentColor: 'blue', attached: 2, startedAt: 0 }),
    )
    expect(linked.map(l => l[0]?.text)).toEqual(['Session', 'Agent', 'Remote', 'Folder'])
    expect(linked[1]?.at(-1)?.text).toBe('colour blue')
    expect(linked[2]?.at(-1)?.text).toBe('2 attached')
    expect(new Set(linked.map(l => starts(l).at(-1))).size).toBe(1)
    expect(panelLines('session', view({ host: null }))).toEqual([])
  })
})

describe('row order', () => {
  test('rows keep their slot order and show only pinned or hovered panels that are on the band', () => {
    expect(rowOrder(['model', 'effort', 'session'], ['model', 'session'], 'effort', ['effort', 'model', 'session'])).toEqual([
      'model',
      'effort',
      'session',
    ])
    expect(rowOrder(['model', 'effort'], ['model'], null, ['effort', 'model'])).toEqual(['model'])
    expect(rowOrder(['model', 'harness'], ['model', 'harness'], null, ['model'])).toEqual(['model'])
  })
})

describe('worktrees panel', () => {
  const text = (line: readonly RowItem[]) =>
    line.map((i, n) => `${n > 0 && !i.tight ? ' '.repeat(ROW_GAP) : ''}${i.text}${' '.repeat(i.pad ?? 0)}`).join('')
  const git = (branch: string, pushed: boolean) => ({
    ...emptyGit('git@github.com:acme/app.git'),
    branch,
    branchPushed: pushed,
    filesModified: 1,
    linesAdded: 5,
    prBaseRef: 'origin/main',
    prBaseName: 'main',
    prAhead: 2,
  })
  const worktrees = [
    { path: 'C:/src/app', name: 'app', current: true, git: git('main', true) },
    { path: 'C:/src/app-feat', name: 'app-feat', current: false, git: git('feat/x', false) },
  ]

  test('each worktree draws its folder, branch and base in the band format', () => {
    const lines = panelLines('worktrees', view({ worktrees }))
    expect(text(lines[0] ?? [])).toBe('Worktrees   click a folder to open it, a pushed branch or a base to view it on GitHub')
    expect(text(lines[1] ?? [])).toBe(
      '            app       |  ⎇ main ◻ 0 1 0 ≡ +5 -0    |  ↑2 ↓0 ⎇ origin/main ◻ 0 0 0 ≡ +0 -0  · this session',
    )
    expect(text(lines[2] ?? [])).toBe('            app-feat  |  ⎇ feat/x ◻ 0 1 0 ≡ +5 -0  |  ↑2 ↓0 ⎇ origin/main ◻ 0 0 0 ≡ +0 -0')
  })

  test('folders link to their path, only a pushed branch links to GitHub, and every base links', () => {
    const lines = panelLines('worktrees', view({ worktrees }))
    expect(lines[2]?.find(i => i.text === 'app-feat')?.pick).toBe(`${FOLDER_PICK}C:/src/app-feat`)
    expect(lines[1]?.find(i => i.text === 'main')?.pick).toBe('https://github.com/acme/app/tree/main')
    expect(lines[2]?.find(i => i.text === 'feat/x')?.pick).toBeUndefined()
    expect(lines[1]?.find(i => i.text === 'origin/main')?.pick).toBe('https://github.com/acme/app/commits/main')
    expect(lines[2]?.find(i => i.text === 'origin/main')?.pick).toBe('https://github.com/acme/app/tree/main')
  })

  test('a worktree not read yet shows a note instead of figures', () => {
    const lines = panelLines('worktrees', view({ worktrees: [{ path: 'C:/src/x', name: 'x', current: false, git: null }] }))
    expect(text(lines[1] ?? [])).toContain('not read yet')
  })
})
