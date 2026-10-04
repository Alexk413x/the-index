# the-index

A Claude Code mod: a plugin of function hooks that draws the status line as a band above
the prompt. `README.md` describes the band, its settings, and how it differs from
`statusline.py`.

## Layout

- `.claude-plugin/` — `plugin.json` (with `userConfig` and the `types` contract) and
  `marketplace.json`. The engine writes `types/` here at each load; it is git-ignored.
- `hooks/hooks.json` — names the one hooks module.
- `hooks/register.tsx` — the hooks module: state atoms, the `$` helpers, and every hook.
- `hooks/format.ts` — pure: config, formatters, and `buildLines`, which builds the band.
- `hooks/git.ts` — pure: git output parsers and the shared rate-limit file's format.
- `hooks/chip.tsx` — the `Client` module for clickable coloured text (the effort, model
  and session names, the pins and the folder name). It has no `$`; it posts `{ press }`
  and `{ hover }` to the hooks module.
- `hooks/row.tsx` — the `Client` module for a hover or pinned row: draws its lines, fades
  in, and posts `{ hover }` and `{ pick, target }` to the hooks module.
- `types/index.d.ts` — the `$.state` contract.
- `tests/` — `*.test.ts(x)` files for `claude plugin test`.
- `knowledge/code_graph.db` — the codebase-kg map of this repo. Committed.
- `.githooks/` — the codebase-kg staleness hooks. Run `sh .githooks/install.sh` once per
  clone.

## Rules

- The function-hooks types file is the authority on the API. Grep
  `.claude-plugin/types/claude-code/index.d.ts` for an event or noun before you use it.
- A function that takes `$` is a top-level function declaration in `register.tsx`, and
  calls `$` as `$.noun.method(...)`. `$.env.get` takes a literal name. The validator
  refuses anything else.
- Keep `format.ts` and `git.ts` free of `$`, so tests call them directly.
- A render hook never writes state. Timers and event hooks write; the band reads.
- Never show an invented figure. A value the API doesn't give is a `░` placeholder, and
  `README.md` lists it under the differences from `statusline.py`.
- Keep the shared rate-limit file's path and shape the same as `statusline.py`'s.
- Before committing, run `claude plugin test .`, `npx -p typescript@5 tsc -p .`,
  `claude plugin validate --strict .` and
  `claude plugin validate --strict .claude-plugin/marketplace.json`. Local results are
  the gate.
