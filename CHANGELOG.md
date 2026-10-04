# Changelog — the-index

All notable changes to the the-index plugin. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-04

### Added

- A context chart on hover: the fill against the full window, the auto-compaction
  threshold, and each compaction.
- Git charts on hover: the working tree's lines and files since the last commit, and the
  last 10 commits on the base branch.

### Changed

- The compaction tally counts Claude Code's compaction event instead of a large drop in
  the context fill.

## [0.2.0] - 2026-10-04

### Added

- Charts on hover: the last 10 calls' tokens and cost (Δ), the session's running totals
  (Σ), and daily tokens for the last 30 days with all-time totals (the rate limits).
- `the-index-usage.json` in the Claude config folder: each session's tokens and cost per
  day, shared by every session running the band.

- `color_primary`, the colour of the band's values, orange by default.
- The agent's name after the harness on line 1, and an Agent row in the session table.
- An agent's colour from its definition file tints the values and the lines around
  open rows; a subagent transcript takes its type's colour.

### Changed

- The lines around open rows follow the prompt border's theme colour by default.
- Row layout lives in a pure module, `hooks/panels.ts`; the folder opens with
  `xdg-open` when `open` fails off Windows.

### Removed

- `/index-debug`.

## [0.1.0] - 2026-10-04

### Added

- A band above the prompt that ports `statusline.py`: session, harness, model and
  effort, IDE, prompt-cache timer, context fill and compactions, uptime, rate limits,
  per-call and session telemetry, and working-tree and PR diffs.
- Rows above the band for the harness, model, effort and session: hover to open
  (300 ms fade in, 600 ms fade out), click a name to pin, pinned rows keep their place.
- Model and effort switching through Claude Code's own `/model` and `/effort`; with a
  subagent's transcript open, the picks apply to that subagent's requests.
- An `ultracode` button that adds or removes the keyword in the prompt draft.
- Opening another agent CLI in a new tab through the ide-agent-tabs plugin.
- A clickable folder name that opens the folder in Explorer or Finder, branch links,
  and the open PR's number and link via the `gh` CLI.
- A Remote Control status before the session name (`●` connected, `○` not connected).
- `userConfig` fields for the dim level, the cache TTL, the context glyphs, each
  segment's visibility and each colour.
- `/index-effort` to pin the effort row and `/index-debug` to compare the band's
  values with Claude Code's.
- The rate-limit file `claude-statusline-ratelimits.json`, shared with `statusline.py`.
