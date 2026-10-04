# Changelog — the-index

All notable changes to the the-index plugin. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/spec/v2.0.0.html).

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
