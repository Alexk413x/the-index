import { describe, expect, test } from 'claude-code/testing'

import {
  GIT_SAFE_ENV,
  assembleRepos,
  belongsToRepo,
  commonDirAt,
  deviceTotal,
  folderKey,
  gitArgv,
  headBranch,
  mapLimit,
  readRepo,
  resolveGitPath,
  uniqueFolders,
  type GitFs,
} from '../hooks/git'

function memoryFs(files: Record<string, string>, dirs: readonly string[]): GitFs & { calls: string[] } {
  const norm = (p: string) => folderKey(p)
  const fileMap = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  const dirSet = new Set(dirs.map(norm))
  const calls: string[] = []
  return {
    calls,
    read: async path => {
      calls.push(path)
      return fileMap.get(norm(path)) ?? null
    },
    kind: async path => (fileMap.has(norm(path)) ? 'file' : dirSet.has(norm(path)) ? 'dir' : null),
    dirs: async path => {
      const prefix = `${norm(path)}/`
      return [...dirSet].filter(d => d.startsWith(prefix) && !d.slice(prefix.length).includes('/')).map(d => d.slice(prefix.length))
    },
  }
}

const WIN = memoryFs(
  {
    'C:/src/app/.git/worktrees/feat/gitdir': 'C:\\src\\app-feat\\.git\r\n',
    'C:/src/app/.git/worktrees/feat/HEAD': 'ref: refs/heads/feat/x\n',
    'C:/src/app/.git/worktrees/feat/commondir': '../..\n',
    'C:/src/app/.git/worktrees/fix/gitdir': '../../../../app-fix/.git\n',
    'C:/src/app/.git/worktrees/fix/HEAD': '3333333333333333333333333333333333333333\n',
    'C:/src/app/.git/worktrees/fix/commondir': '../..\n',
    'C:/src/app/.git/worktrees/gone/gitdir': 'C:/src/app-gone/.git\n',
    'C:/src/app/.git/worktrees/gone/HEAD': 'ref: refs/heads/old\n',
    'C:/src/app-feat/.git': 'gitdir: C:\\src\\app\\.git\\worktrees\\feat\n',
    'C:/src/app-fix/.git': 'gitdir: ../app/.git/worktrees/fix\n',
  },
  ['C:/src/app', 'C:/src/app/.git', 'C:/src/app/.git/worktrees', 'C:/src/app/.git/worktrees/feat', 'C:/src/app/.git/worktrees/fix', 'C:/src/app/.git/worktrees/gone', 'C:/src/app-feat', 'C:/src/app-fix', 'C:/src/notes'],
)

const POSIX = memoryFs(
  {
    '/Users/me/src/lib/.git/worktrees/wt/gitdir': '/Users/me/src/lib-wt/.git\n',
    '/Users/me/src/lib/.git/worktrees/wt/HEAD': 'ref: refs/heads/dev\n',
    '/Users/me/src/lib-wt/.git': 'gitdir: /Users/me/src/lib/.git/worktrees/wt\n',
    '/Users/me/src/lib/.git/worktrees/wt/commondir': '../..\n',
  },
  ['/Users/me/src/lib/.git', '/Users/me/src/lib/.git/worktrees', '/Users/me/src/lib/.git/worktrees/wt', '/Users/me/src/lib-wt', '/Users/me/src/Lib-Other/.git'],
)

describe('filesystem worktree reader', () => {
  test('a main repo resolves to its own .git folder', async () => {
    expect(await commonDirAt(WIN, 'C:\\src\\app')).toBe('C:/src/app/.git')
    expect(await commonDirAt(POSIX, '/Users/me/src/lib/')).toBe('/Users/me/src/lib/.git')
  })

  test('a linked worktree resolves through its .git file and commondir, absolute or relative', async () => {
    expect(await commonDirAt(WIN, 'C:/src/app-feat')).toBe('C:/src/app/.git')
    expect(await commonDirAt(POSIX, '/Users/me/src/lib-wt')).toBe('/Users/me/src/lib/.git')
    expect(resolveGitPath('C:/src/app-fix', '../app/.git/worktrees/fix')).toBe('C:/src/app/.git/worktrees/fix')
    expect(resolveGitPath('/a/b', '/c/d\n')).toBe('/c/d')
  })

  test('a folder without .git is no repo', async () => {
    expect(await commonDirAt(WIN, 'C:/src/notes')).toBe('')
  })

  test('the reader lists extra worktrees, skips missing folders, and reads branch or detached HEAD', async () => {
    expect(await readRepo(WIN, 'C:/src/app/.git')).toEqual({
      commonDir: 'C:/src/app/.git',
      main: 'C:/src/app',
      trees: [
        { path: 'C:/src/app-feat', branch: 'feat/x' },
        { path: 'C:/src/app-fix', branch: '' },
      ],
    })
    expect(headBranch('ref: refs/heads/feat/x\n')).toBe('feat/x')
    expect(headBranch('3333333333333333333333333333333333333333')).toBe('')
    expect(headBranch(null)).toBe('')
  })

  test('a cwd that is not a repo counts the extra worktrees of its repo children', async () => {
    const children = (await WIN.dirs('C:/src')).map(name => `C:/src/${name}`)
    const found = await Promise.all(children.map(c => commonDirAt(WIN, c)))
    const reads = await Promise.all(uniqueFolders(found.filter(Boolean)).map(d => readRepo(WIN, d)))
    const repos = assembleRepos(reads, '')
    expect(repos.map(r => [r.name, r.current, r.trees.length])).toEqual([['app', false, 2]])
    expect(deviceTotal(repos)).toBe(2)
  })

  test('a child that is a worktree of another child counts once', async () => {
    const found = await Promise.all(['C:/src/app', 'C:/src/app-feat', 'C:/src/app-fix'].map(c => commonDirAt(WIN, c)))
    expect(uniqueFolders(found)).toEqual(['C:/src/app/.git'])
  })

  test('a repo cwd marks its repo current and lists it first', async () => {
    const reads = [await readRepo(POSIX, '/Users/me/src/lib/.git'), await readRepo(WIN, 'C:/src/app/.git')]
    const repos = assembleRepos(reads, '/Users/me/src/lib/.git')
    expect(repos.map(r => [r.name, r.current])).toEqual([
      ['lib', true],
      ['app', false],
    ])
    expect(repos[0]?.trees).toEqual([{ path: '/Users/me/src/lib-wt', name: 'lib-wt', branch: 'dev' }])
    expect(deviceTotal(repos)).toBe(3)
  })

  test('reading a child repo runs no git: it only reads files under .git', async () => {
    WIN.calls.length = 0
    await readRepo(WIN, await commonDirAt(WIN, 'C:/src/app-feat'))
    expect(WIN.calls.every(p => /\/\.git(\/|$)/i.test(p.replace(/\\/g, '/')))).toBe(true)
  })

  test('Windows folders dedupe across slash styles and case, POSIX folders keep case', () => {
    expect(uniqueFolders(['C:\\src\\app', 'c:/src/app/', 'C:/Src/App', '/Users/me/App', '/Users/me/app/'])).toEqual(['C:/src/app', '/Users/me/App', '/Users/me/app'])
  })
})

describe('git hardening', () => {
  test('git runs with fsmonitor, the untracked cache, the pager, optional locks and system config off', () => {
    const argv = gitArgv('C:/src/app', ['status', '--porcelain=v2', '--branch'])
    expect(argv.slice(0, 3)).toEqual(['git', '-C', 'C:/src/app'])
    const options = argv.slice(3, argv.indexOf('status'))
    for (const setting of ['core.fsmonitor=false', 'core.untrackedCache=false', 'core.pager=cat']) {
      expect(options[options.indexOf(setting) - 1]).toBe('-c')
    }
    expect(options).toContain('--no-optional-locks')
    expect(argv.slice(argv.indexOf('status'))).toEqual(['status', '--porcelain=v2', '--branch'])
    expect(GIT_SAFE_ENV).toEqual({ GIT_CONFIG_NOSYSTEM: '1' })
  })

  test("git runs in the session repo's worktrees only when their git dir belongs to the repo", () => {
    expect(belongsToRepo('C:\\src\\app\\.git\\worktrees\\feat', 'C:/src/app/.git')).toBe(true)
    expect(belongsToRepo('C:/src/app/.git', 'c:/src/app/.git')).toBe(true)
    expect(belongsToRepo('D:/evil/.git', 'C:/src/app/.git')).toBe(false)
    expect(belongsToRepo('C:/src/app/.gitx/worktrees/feat', 'C:/src/app/.git')).toBe(false)
    expect(belongsToRepo('/Users/me/lib/.git/../../evil/.git', '/Users/me/lib/.git')).toBe(false)
  })

  test('mapLimit keeps order and never runs more than its limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async n => {
      running += 1
      peak = Math.max(peak, running)
      await Promise.resolve()
      running -= 1
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })
})
