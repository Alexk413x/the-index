# The Index

A three-line band above the Claude Code prompt that shows what your session costs, how
close you are to a limit, and where your code stands, without leaving the prompt.

```
● peer | Claude Opus 5.5 high | VS Code | ☼ 50m 💥 ◑ 45% 1h2m ◵ 23% 2h5m ⧈ 61% 3d4h
Δ »3 ↑50k ⤒1.5k ⤓48k ↓800 ↯200 ⌖96% ≡+3 -1 ⏱ 4.0s $0.12 | Σ ◦2 »5 ↑100k ⤒20k ⤓80k ↓3.0k ↯75 ⌖79% 90% ≡+40 -7 ⏱ 1m5s $1.50
□ app | ⎇ feat/x ◻ 1 2 0 ≡ +10 -4 | ↑3 ↓0 ⎇ #42 origin/main ◻ 0 4 0 ≡ +50 -9
```

## Install

```sh
claude plugin marketplace add Alexk413x/the-index
claude plugin install the-index@the-index
```

The repository is private, so the marketplace needs GitHub access to it.

> **Pre-1.0.** The band runs on function hooks, an early-access Claude Code API that
> changes between releases.

## Features

- **Session at a glance.** See the model, effort, context fill, prompt-cache time left
  and rate limits, so you know when to compact, switch models or slow down.
- **Cost and token telemetry.** See what the last turn and the whole session cost in
  tokens, cache hits, speed and dollars, so expensive turns stand out.
- **Git state.** See what your next commit and your next PR hold, so you don't need to
  run `git status` or open GitHub.
- **Charts on hover.** Hover a section for a chart: context over time, daily usage,
  turn and session scorecards, and commit history with uncommitted changes. Click to
  pin it.
- **Switch from the band.** Change the model or effort with one click, for the main
  session or a subagent.
- **Subagent view.** Open a subagent's transcript and the band shows that agent's model,
  effort and status.
- **GitHub buttons.** Open the repo, the branch, the commits, your PR or the open PR
  list from the git rows.
- **Copy the session name.** Click it in the session table.

## Works with

- **ide-agent-tabs plugin:** when installed, hover the harness name at the start of
  line 1 to open Codex, Gemini CLI or another agent CLI in a new tab.
- **`gh` CLI:** when installed, the band shows your open PRs and charts merged PRs.

## Settings

Change settings in the `/config` menu. Every setting is optional.

- **Look**
  - `dim`: dims every colour, from `0.1` to `1`. Default `0.95`.
  - `glyphs`: the context circle style, `unicode` or `nerd` (needs a Nerd Font).
- **Cache timer**
  - `cache_ttl`: the cache lifetime the countdown starts from, `1h` or `5m`.
- **Segments to show** (all on by default)
  - Line 1: `show_remote`, `show_session`, `show_model`, `show_ide`, `show_cache`,
    `show_context`, `show_uptime`, `show_rate_limits`, `show_agent_view`.
  - Line 2: `show_calls` (the Δ turn), `show_totals` (the Σ session).
  - Line 3: `show_project`, `show_commit_diff` (the branch), `show_pr_diff` (the base
    branch).
- **Colours** (hex values)
  - `color_primary`: the band's main colour, orange `#d75f00` by default.
  - Values: `color_session`, `color_model`, `color_ide`, `color_uptime`,
    `color_resets`, `color_calls`, `color_totals`, `color_project`, `color_branch`.
  - Levels: `color_good`, `color_warn`, `color_high`, `color_bad`, `color_cold`.
  - Other: `color_icons` for icons and separators, `color_rules` for the lines around
    open rows.

A figure Claude Code doesn't report shows as `░`.

## Develop

Run every check before you commit:

```sh
claude plugin test .
npx -p typescript@5 tsc -p .
claude plugin validate --strict .
claude plugin validate --strict .claude-plugin/marketplace.json
```

To load a local checkout, run `claude --plugin-dir .`, or add the path to
`CLAUDE_CODE_PLUGIN_DIRS`. Run `sh .githooks/install.sh` once per clone.

## Licence

Free to use, including at work, and free to fork and share. You may not sell it, a fork
of it, or paid setup or hosting of it, and you may not use it for fraud or scams. See
[LICENSE](LICENSE) for the full terms: Apache 2.0 with a no-resale condition. The
software is not open source.
