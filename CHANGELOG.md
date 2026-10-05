# Changelog — the-index

All notable changes to the the-index plugin. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-10-04

### Changed

- ↑ shows everything a call sent: uncached input, cache writes and cache reads. The API's
  uncached input alone is a few tokens a call with prompt caching on.

### Fixed

- A call's cost is the session cost's rise during that call; it had taken the rise since
  the previous main call, which folded in subagent costs and showed $0.00 after a reload.
- A call's lines are the edits it asked for; they had been credited to the next call.

## [0.7.1] - 2026-10-04

### Changed

- A blank row separates the lines and files charts in the git rows.

## [0.7.0] - 2026-10-04

### Added

- The `origin/main` row lists every open PR into the base branch as a button.
- Buttons and choices in a row underline under the pointer.

### Changed

- Each git chart splits into a lines chart (added up, removed down) and a files chart
  (added, modified and deleted stacked), with each column's details on hover.
- Chart notes read as plain text ("peak 55 lines", "more per token") without `▲`, `▼` or
  `■` marks.

## [0.6.3] - 2026-10-04

### Changed

- The working-tree chart gives its rate in lines per minute, not lines an hour.

## [0.6.2] - 2026-10-04

### Changed

- The cost chart labels read "more per token" and "less per token" (and per line)
  instead of "dearer" and "cheaper".

## [0.6.0] - 2026-10-04

### Added

- Δ and Σ each split into a token half and a code half with their own charts: lines per
  turn coloured by cost per line against the average, and the session's lines, lines per
  minute and cost per line.

### Changed

- The Σ token chart gives each total its own line, with its current value.

## [0.5.2] - 2026-10-04

### Changed

- Σ tokens per second is the average of each call's own rate, not total output over total
  API time.

## [0.5.1] - 2026-10-04

### Fixed

- Σ output and tokens per second showed `NaN` in a session that started before 0.5.0;
  they show `░` there, and real figures in new sessions. The turn chart skips calls
  logged before turns were recorded.

## [0.5.0] - 2026-10-04

### Changed

- The Δ chart bars cost per token for each turn against the session average, red above
  and green below; hovering a bar shows that turn's totals.
- Σ shows tokens sent, cache writes, cache reads, output and the average tokens per
  second, as Δ does.

## [0.4.0] - 2026-10-04

### Changed

- The git sections are one button each that opens or pins their chart row; the GitHub
  links are buttons in that row: `View branch`, `View PR #N`, `Create PR` or
  `View commits`.
- The cache timer opens the context chart, which shows how long the cache stays warm.

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
