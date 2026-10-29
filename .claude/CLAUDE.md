# the-index

A Claude Code mod: a plugin of function hooks that draws a status band above the
prompt. `README.md` summarizes its features and settings for users. The plugin ships
through the `alexk413x` marketplace in the `Alexk413x/marketplace` repo.

## Layout

- `.claude-plugin/` — `plugin.json` (with `userConfig` and the `types` contract). The
  engine writes `types/` here at each load; it is git-ignored.
- `hooks/hooks.json` — names the one hooks module.
- `hooks/register.tsx` — the hooks module: `register` and every hook. Each hook calls
  into a feature file.
- Feature files, which take `$`:
  - `hooks/band.tsx` — draws the band and the hover and pinned rows above it.
  - `hooks/rows.ts` — hover, pins and row slots; a pick in a row; model, effort and
    ultracode switching; the band's `ui.message` handling.
  - `hooks/pane.tsx` — the Details pane: opening, its messages, the texts it reads, and
    its drawing.
  - `hooks/usage.ts` — rate limits and the shared limits file, the context log and
    limit, compactions, call and turn totals, the band's tick, and the shared usage and
    turn files.
  - `hooks/repo.ts` — git snapshots, pull requests, worktrees, device repos, and the
    polls that keep them current.
  - `hooks/host.ts` — session and IDE info, agent colours, agent tabs, sentinel-swarm,
    and opening URLs and folders.
- `hooks/lib/` — pure modules with no `$`:
  - `format.ts` — config, formatters, and `buildLines`, which builds the band.
  - `panels.ts` — the rows above the band (`panelLines`), their order, and which model
    and effort are current.
  - `panels/` — the row builders `panelLines` calls:
    - `constants.ts` — widths, heights, and pick prefixes shared by the row builders.
    - `kit.ts` — `rowKit`, the helpers every row builder shares, and the `padTo` and `sectionWidth` layout functions.
    - `git.ts` — the base and branch rows.
    - `meters.ts` — the context, call and total cards, and usage rows.
    - `pickers.ts` — the harness, effort and model rows.
    - `session.ts` — the session row.
    - `worktrees.ts` — the worktrees row.
  - `git.ts` — git output parsers and the shared rate-limit file's format.
  - `agents.ts` — agent file frontmatter and the theme key of an agent colour.
  - `charts.ts` — braille line charts and block bar charts as row items.
  - `ledger.ts` — the shared daily usage file's format, merge and summary.
  - `turns.ts` — the shared turn history file's format, merge, and the cards' averages.
  - `detail.ts` — the Details pane's tabs, rows and column layout, and the context
    breakdown.
- `hooks/clients/` — the `Client` modules. They have no `$`.
  - `chip.tsx` — clickable coloured text (the effort, model and session names, the pins
    and the folder name). It posts `{ press }` and `{ hover }` to the hooks module.
  - `row.tsx` — a hover or pinned row: draws its lines, fades in and out, and posts
    `{ hover }`, `{ pick, target }` and `{ faded }` to the hooks module.
- `types/index.d.ts` — the `$.state` contract.
- `tests/` — `*.test.ts(x)` files for `claude plugin test`.
- `knowledge/code_graph.db` — the codebase-kg map of this repo. Committed.
- `.githooks/` — the codebase-kg staleness hooks. Run `sh .githooks/install.sh` once per
  clone.

## Rules

- The function-hooks types file is the authority on the API. Grep
  `.claude-plugin/types/claude-code/index.d.ts` for an event or noun before you use it.
- A function that takes `$` is a top-level function declaration in `register.tsx` or a
  feature file in `hooks/`, and calls `$` as `$.noun.method(...)`. `$.env.get` takes a
  literal name. The validator refuses anything else.
- `read` and `update` take an atom declared in the same file. The validator refuses an
  imported atom, so each file declares the atoms it uses, and one key may be declared
  in several files. When an atom's initial value is not `null`, `0`, `false`, `[]` or
  `{}`, every declaration uses the same constant from `hooks/lib/`, such as
  `EMPTY_TOTALS`.
- A hook matcher's value is a const in `register.tsx`. The validator does not read an
  imported one.
- Keep the files in `hooks/lib/` free of `$`, so tests call them directly.
- A render hook never writes state. Timers and event hooks write; the band reads.
- Never show an invented figure. A value the API doesn't give is a `░` placeholder.
- Keep the shared rate-limit file's path and shape the same as `statusline.py`'s.
- Before committing, run `claude plugin test .`, `npx -p typescript@5 tsc -p .` and
  `claude plugin validate --strict .`. Local results are the gate.
