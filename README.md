# the-index

A Claude Code mod that draws the status line as a band above the prompt. It ports
`statusline.py`, a three-line command status line, to a plugin of function hooks.

The band adds one thing a status-line command can't do. When you open a subagent's
transcript from the tasks list, the model segment shows that agent's model, effort,
type and status instead of the main session's.

> **Status: pre-1.0.** The function-hooks API is early access and changes between
> Claude Code releases. This version targets Claude Code 2.1.288.

## The band

```
● peer | Claude Opus 5.5 high | VS Code | ☼ 50m 💥 ◑ 45% 1h2m ◵ 23% 2h5m ⧈ 61% 3d4h
Δ ↑12 ⤒1.5k ⤓48k ↓800 ↯200 ⌖96% ≡+3 -1 ⏱ 4.0s $0.12 | Σ ⤒20k ⌖79% 90% ≡+40 -7 ⏱ 1m5s $1.50
□ app | ⎇ feat/x ◻ 1 2 0 ≡ +10 -4 | ↑3 ↓0 ⎇ #42 origin/main ◻ 0 4 0 ≡ +50 -9
```

- **Line 1:** Remote Control status (`●` connected, `○` not connected), session name,
  harness, agent, model and effort, IDE, prompt-cache timer, compaction tally, context fill, uptime, and the 5-hour and 7-day rate limits.
- **Line 2:** the last main-loop API call (Δ) and the session totals (Σ), each with
  tokens sent, cache writes, cache reads, output, tokens per second, cache hit, lines,
  API time and cost. Σ's tokens per second is the average of each call's own rate, so
  idle time and a few long calls don't skew it.
- **Line 3:** the folder, then two sections:
  - **The checked-out branch:** what the next commit would hold, the working tree against
    `HEAD` (files added, changed and deleted, and lines).
  - **`origin/main`:** what a PR would look like now, everything since the branch started
    against the remote base (commits ahead and behind, files and lines). It shows the open
    PR's number first (`#42 origin/main`), found with the `gh` CLI.
  Each section opens its chart row, which holds the GitHub buttons (see Charts).
  Click the folder name to open it in Explorer, Finder or, on Linux, the app `xdg-open` picks.

With a subagent transcript open, line 1's model segment reads
`⤷ <type> <name or description> <model> <effort> <status>`.

## Hover to change, click to pin

The harness name, the model name, the effort and the session name each open a row
above the band. Rest
the pointer on a name for a moment and its row fades in over 300 ms; it stays while the
pointer is on the name or the row. When the pointer leaves both, the row fades out over
600 ms and then closes; coming back during the fade restores it at full brightness, so
a slip or overshoot doesn't lose it. Click a choice to pick it. While a row has the keyboard,
Left and Right move between its choices and Enter picks one.

Click a name to pin its row open; a pinned name stays inverted (orange background).
Pinned rows stack above the band, the most recently pinned at the bottom next to the
band. The orange `■` at the start of a pinned row unpins it; `□` on a hovered row pins
it. A row keeps its place while it's open: unpinning it with the pointer still on it
leaves it where it is, and it leaves the stack only once it hides.

## Open another harness

Line 1 starts with the harness name (`Claude`). With the ide-agent-tabs plugin
installed, hovering it lists the installed agent CLIs (Claude Code, Codex, Gemini CLI,
Copilot CLI and custom profiles); click one to open it in a new IDE or terminal tab in
the current folder, through agent tabs' `open_tab`. Without agent tabs, the name is
plain text.

## Change effort from the band

Hover the effort on line 1 for a row above the band with `low` to `max`, `ultracode`
and `default`; click the effort, or run `/index-effort`, to pin that row open. In the
main session a pick runs Claude Code's own `/effort` (`default` runs `/effort auto`),
so the change is real, exactly as typing `/effort` is. With a
subagent's transcript open, the pick applies to that subagent's requests instead.

Both rows end with a `default` column. `default` is orange while you're on the
default (no saved effort for the model, or `/effort auto`; no saved model, or
`/model default`). Otherwise clicking it switches back: `/effort auto` or `/model default`.

The effort row also has an `ultracode` button. It adds the word `ultracode` to your
prompt draft, or removes it, and is orange while the word is in the draft. That keyword
is how Claude Code turns ultracode on for a message; mods have no direct switch.

## Switch the model from the band

Hover the model name on line 1 for a row with Fable 5.1, Opus 5.5, Sonnet 5.5,
Haiku 4.5 and `default`. In the main session a pick runs Claude Code's own `/model`
with that name, so the session really switches and the model knows what it is.
In an interactive session `/model` also saves the choice as your default, as it
does when you type it. With a subagent's transcript open, the pick applies to that
subagent's requests, and if that model doesn't answer the band goes back to the
subagent's own model. The band reads the session's model each time it draws, and after a switch it
shows the effort that model has saved in your settings.

The list is a table in `hooks/format.ts`. Mods can't read the `/model` picker's list.

## Session details

Hover the session name for a table of the session name and full id with its start
time, the agent and its colour, the Remote Control session id and attached clients when
linked, and the folder with the Claude Code version.

## Charts

Hover a section of the band for a chart in a row above it:

- **The cache timer and context fill:** the context window's fill across the session
  against the full window, a dashed line where auto-compaction starts (Claude Code's own
  threshold, when auto-compaction is on), `▲` under each compaction, and how long the
  prompt cache stays warm.
- **Δ, its token half (↑ to ⌖):** cost per token for each turn, the last 20 turns,
  against the session's average in the middle. A red bar above it cost more per token
  than average; a green bar below it cost less. Hover a bar for that turn's tokens, cost,
  cost per million tokens, cache hit, output and tokens per second.
- **Δ, its code half (≡, ⏱, $):** lines changed in each turn as bars, green when the turn
  cost less per line than the session average and red when it cost more. Hover a bar for
  the turn's lines, time, lines per minute and cost per line.
- **Σ, its token half:** one line for each session total (tokens sent, cache writes, cache
  reads, output, tokens per second, cache hit and cost) showing its growth, with its
  current value.
- **Σ, its code half:** lines changed, lines per minute and cost per line across the
  session's turns. Lines per minute counts the time turns ran, not idle time.
- **The rate limits:** tokens per day for the last 30 days as bars, with today's tokens,
  the 30-day and all-time totals, and their cost.
- **The checked-out branch:** lines added and removed and files changed in the working
  tree, plotted over the time since the last commit, with the rate in lines an hour. Its
  `View branch ↗` button opens the branch on GitHub once it's pushed.
- **`origin/main`:** lines added and removed and files changed in each of the last 10
  commits on the base branch, with the latest commit's subject. Its button opens the open
  PR (`View PR #42 ↗`), GitHub's create-PR page when there's none (`Create PR ↗`), or on
  `main` itself the commit history (`View commits ↗`).

A terminal cell takes one colour, so where two lines of a chart cross, the cell shows the
first line's colour. Tokens count input, cache writes, cache reads and output. Click a section to pin its
chart, as with the other rows.

The daily chart reads `the-index-usage.json` in your Claude config folder. Every session
running the band adds its own tokens and cost per day there, main loop and subagents
alike, so the chart covers usage since you installed the band, and says since when.

## Colours

The band's values (session, model, effort, IDE, uptime, resets, telemetry, folder and
branches) draw in one primary colour, orange (`#d75f00`) unless you set `color_primary`.

When the session runs as an agent whose definition sets a `color`, that colour replaces
the primary colour and the lines around open rows, as Claude Code colours the agent's
own label. With a subagent's transcript open, the subagent type's colour applies, if its
definition has one.

The lines above and below open rows draw in the prompt border's theme colour, so they
follow your theme. Set `color_rules` to a hex colour to fix them.

A segment colour you set to anything other than `#d75f00` keeps that colour; the
primary and agent colours leave it alone.

## Install

The repo is its own marketplace. To install it:

```sh
claude plugin marketplace add Alexk413x/the-index
claude plugin install the-index@the-index
```

The repository is private, so the marketplace needs GitHub access to `Alexk413x/the-index`.

To try a local checkout instead, load the folder for one session:

```sh
claude --plugin-dir path/to/the-index
```

For apps you can't pass a flag to (the desktop app, an SDK host), add the path to
`CLAUDE_CODE_PLUGIN_DIRS`. Don't install from the marketplace and load the folder at the
same time: the band would load twice.

The band and a `statusLine` command can run together. To use only the band, remove
`statusLine` from `~/.claude/settings.json`.

## Settings

Each setting is a `userConfig` field. Change it in the config menu, or under
`pluginConfigs.the-index` in settings.

| Field | Default | What it does |
|---|---|---|
| `dim` | `0.95` | Scales every colour toward black, from 0.1 to 1. |
| `cache_ttl` | `1h` | The lifetime the warm-cache countdown counts down from: `1h` or `5m`. |
| `glyphs` | `unicode` | The context circle: `unicode` fills in 5 steps (`○◔◑◕●`); `nerd` fills in 9 Nerd Font slices and needs a Nerd Font. |
| `show_<segment>` | `true` | Draws the segment. Segments: `remote`, `session`, `model`, `ide`, `cache`, `context`, `uptime`, `rate_limits`, `calls`, `totals`, `project`, `commit_diff`, `pr_diff`, `agent_view`. |
| `color_primary` | `#d75f00` | The hex colour of the band's values. An agent's colour replaces it while that agent runs. |
| `color_<name>` | script colours | A hex colour. Names: `session`, `model`, `ide`, `uptime`, `resets`, `calls`, `totals`, `project`, `branch` (segment values, which follow `color_primary` at `#d75f00`); `icons`, `good`, `warn`, `high`, `bad`, `cold` (glyphs and levels); `rules` (the lines around open rows; empty follows the prompt border). |

## Where each figure comes from

| Figure | Source in the mod API |
|---|---|
| Context %, cost, rate limits, session start | `session.measure` and `$.session.usage()` |
| Model and effort, per agent | `turn.step` (`model`, `effort`, `agentId`) |
| Per-call tokens, cache hit, tokens/s, API time | `turn.step` result `usage`, timed around the request |
| Lines added and removed | `Edit` and `Write` results' `structuredPatch` |
| Cache timer | Time of the last main-loop response plus `cache_ttl` |
| Subagent type and status | `$.agent.list()` |
| Agent and its colour | The `agent` setting; `name` and `color` in the frontmatter of `~/.claude/agents/*.md` and `.claude/agents/*.md` |
| Session name, IDE | `~/.claude/sessions` and `~/.claude/ide`, as the script reads them |
| Remote Control status | `bridgeSessionId` in the session's `~/.claude/sessions` entry; remote clients from `session.attach` and `session.detach` |
| Git | `git` through `$.process.run`, 2 s after an `Edit`, `Write` or `Bash` call and after each turn; every 30 s the band compares the mtimes of `.git/index`, `HEAD`, `FETCH_HEAD` and `ORIG_HEAD` and runs git only when one changed; a full refresh runs every 5 min |

The mod shares `claude-statusline-ratelimits.json` in the temp folder with
`statusline.py`, so both show the freshest rate limits across open sessions.

## Redraws

The band redraws when its state changes. While idle it redraws at the next moment a
shown value changes: the cache countdown's next minute (each second in its last
minute), a rate-limit reset's next minute, or at most 60 s later.

## Differences from statusline.py

- **Session totals.** The script's Σ shows cache writes and hit rates. The band's Σ also
  shows tokens sent, cache reads, output and the average tokens per second, as Δ does.
- **Cache glyph.** The script shows `☼` while warm and `❅` when cold. The band
  steps through `☀ ☼ ❅` as the cache ages, then shows `❄` when cold.
- **Remote Control.** The registry field is the CLI's own file, not mod API, and can
  change between releases.
- **Cache TTL.** The mod API reports the cache's TTL only when the model switches.
  Until then the timer counts down `cache_ttl` from the last main-loop response.
- **Cache hit rates.** The script reads the harness's `prompt_cache` stats. The band
  sums main-loop responses since the session started in this process.
- **Totals after an update.** A session that started before an update keeps its earlier
  totals; a figure the earlier build didn't count shows `░` until a new session.
- **Totals after a restart.** Σ tokens, API time and lines restart when the process
  restarts or resumes a session. Cost, context and rate limits don't.
- **API time.** The band measures each request's wall time, retries included. The
  script uses the harness's API duration.
- **Lines.** The band counts `Edit` and `Write` patches. `NotebookEdit` and Bash edits
  don't count.
- **Session name.** The band reads the peer name. A `/rename` title isn't in the API.
- **Agent name.** The band reads the `agent` setting. The `--agent` flag isn't in the
  API.
- **Agent colour.** The band reads agent files in your user and project `agents`
  folders. A plugin's agents, agents passed with `--agents`, and a `/color` override
  aren't in the API, so they keep the primary colour.
- **Compactions.** The `💥` tally counts Claude Code's compaction event, not a 30-point
  drop in the context fill, so a `/clear` no longer counts.
- **Working-tree chart.** The band samples the working tree when it refreshes git, so
  the chart starts at the first sample after the last commit, or after the band loaded.
- **Daily usage.** Claude Code keeps no daily history a mod can read. The band counts
  usage from the day it was installed, in sessions where it runs, and shows days before
  that as `·`.
- **Project link.** A band link takes only `https:`, so the folder name isn't a
  `file://` link; clicking it opens the folder through the operating system instead.

## Develop

Run every check before you commit:

```sh
claude plugin test .
npx -p typescript@5 tsc -p .
claude plugin validate --strict .
claude plugin validate --strict .claude-plugin/marketplace.json
```

`tsc` reads the types the engine lays in `.claude-plugin/types/` when it loads the
folder. In a fresh clone, load the plugin once first, for example with
`claude -p --plugin-dir . "ok"`.

Run `sh .githooks/install.sh` once per clone to wire the codebase-kg git hooks.

## Licence

Proprietary. See [LICENSE](LICENSE) and [EULA.md](EULA.md).
