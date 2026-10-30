import type { PanelView, RowItem } from '../panels'
import { gitLinks, gitParts, SYM_BR, SYM_WT } from '../format'
import { FOLDER_PICK } from './constants'
import { padTo, sectionWidth, type Kit } from './kit'

export function worktreeLines(view: PanelView, kit: Kit): RowItem[][] {
  const { cfg } = view
  const c = cfg.colors
  const { note, title, blankTitle } = kit
  const sep = (): RowItem => note('|')
  const asItems = (segs: readonly { text: string; color: string }[], pick?: string): RowItem[] =>
    segs.map((s, i) => ({ text: s.text, color: s.color, ...(i > 0 ? { tight: true } : {}), ...(pick ? { pick, link: true } : {}) }))
  const folder = (name: string, path: string): RowItem[] => [
    note(`${SYM_WT} `),
    { text: name, color: c.project, pick: `${FOLDER_PICK}${path}`, link: true, tight: true },
  ]
  type Row = { folder: RowItem[]; branch: RowItem[]; base: RowItem[]; current: boolean }
  const repos = view.deviceRepos ?? []
  const trees = view.worktrees ?? []
  const groups: Row[][] = []
  if (trees.length > 1) {
    groups.push([
      ...trees.map(tree => {
        const parts = tree.git?.branch ? gitParts(tree.git, cfg) : null
        const links = gitLinks(tree.git)
        return {
          folder: folder(tree.name, tree.path),
          branch: parts ? asItems(parts.branch, links.branch) : [note(tree.git ? 'detached' : 'not read yet')],
          base: parts?.base ? asItems(parts.base, links.base?.url ?? links.repo) : [],
          current: tree.current,
        }
      }),
    ])
  }
  for (const repo of repos) {
    if (repo.trees.length === 0 || (repo.current && trees.length > 1)) continue
    groups.push([
      ...repo.trees.map(tree => ({
        folder: folder(tree.name, tree.path),
        branch: asItems([
          { text: SYM_BR, color: c.icons },
          { text: ' ', color: c.icons },
          { text: tree.branch || 'detached', color: tree.branch ? c.branch : c.icons },
        ]),
        base: [],
        current: false,
      })),
    ])
  }
  const rows = groups.flat()
  const folderWidth = Math.max(0, ...rows.map(r => sectionWidth(r.folder)))
  const branchWidth = Math.max(0, ...rows.map(r => sectionWidth(r.branch)))
  return [
    [title('Worktrees'), note('click a folder to open it, a pushed branch or a base to view it on GitHub')],
    ...rows.map(r => [
      blankTitle(),
      ...padTo(r.folder, folderWidth),
      sep(),
      ...(r.base.length ? padTo(r.branch, branchWidth) : r.branch),
      ...(r.base.length ? [sep(), ...r.base] : []),
      ...(r.current ? [note('· this session')] : []),
    ]),
  ]
}
