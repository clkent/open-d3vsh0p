# Proposal: slack-control

## Why

Every d3vsh0p session (kickoff, talk, run, pair) is an interactive Claude Code CLI bound to a terminal on one Mac. Once the operator walks away, there is no way to start a run, answer a question Riley or Morgan asks, or even learn that Morgan stopped, other than sitting back down at that terminal. Overnight and away-from-desk operation already works mechanically (usage-limit waits, idle continuation), but it is blind and one-way: nothing tells the operator when a session needs them, and nothing lets them reply from a phone. This change makes d3vsh0p operable from Slack on a phone: send commands in, get questions and stop events out, and chat with the running agent in a thread.

## What Changes

- **Remote Control on interactive sessions.** A `remoteControl` config flag and `--remote-control` CLI option start every spawned Claude Code session with Remote Control enabled, so the same session is reachable from the Claude mobile app with full transcript sync and push notifications when the agent needs a decision. This is Anthropic's supported path for phone access to a local session and needs no d3vsh0p infrastructure; it ships first and stands alone.
- **Session event hooks.** The orchestrator injects Claude Code hooks (`Stop`, `Notification`, `SessionEnd`, `PreToolUse` on `AskUserQuestion`) into every spawned session via the `--settings` flag, without editing the project's own `.claude/settings.json`. Hooks and the run lifecycle (session started, usage-limit wait, idle continuation, run ended, health check failed, consolidation PR, HUMAN items pending) post structured events to a local event sink. When no sink is listening, events are dropped silently and sessions behave exactly as today.
- **Slack bridge daemon.** A new `devshop slack` command runs a long-lived bridge on the Mac using Slack Socket Mode (outbound WebSocket, no public URL, no npm dependency: Node's built-in `WebSocket` and `fetch`). Inbound: `run`, `talk`, `pair`, `kickoff`, `status`, `stop`, `sessions`, `help` from an allowlisted Slack user, plus free-text replies in a session's thread. Outbound: one Slack thread per session that mirrors the agent's turn-ending messages, questions, permission prompts, idle stops, and run summaries. The bridge is the event sink for the hooks above and can be installed as a launchd agent so it survives reboots.
- **tmux-hosted sessions.** Sessions started from Slack have no terminal, and terminal-started sessions have no input path for Slack replies. Both are solved by running the Claude CLI inside a named tmux session (`devshop-<project>-<type>`): detached when started from Slack, attached in the foreground when started from a terminal. The bridge delivers Slack replies with `tmux send-keys` (literal mode, never shell-interpreted). tmux hosting is enabled only when `slack.enabled` is set, so the default terminal experience is unchanged.
- **Local config overlay.** A gitignored `config.local.json` at the d3vsh0p root, merged between `defaults.json` and per-project overrides, holds machine-level settings (Slack allowlist, ports, Remote Control default). Slack tokens are read from the root `.env` (already gitignored) via `process.loadEnvFile`.

Not in scope: a custom Slack *channel* MCP server (Claude Code Channels are a research preview with no Slack plugin, a confirmation prompt on every dev-flag launch, and an npm SDK dependency), Claude in Slack / Claude Tag (cloud sessions, cannot reach a local terminal), and the REST API (the bridge spawns sessions directly, the same way the API's process manager does).

## Capabilities

### New Capabilities
- `remote-control-sessions`: interactive sessions can start with Claude Code Remote Control enabled via config or CLI flag, with session names that identify the agent and project.
- `session-event-hooks`: the orchestrator injects Claude Code hooks at spawn time and emits run-lifecycle events to a local HTTP event sink; a shared event schema; silent no-op when no sink is running.
- `slack-control`: the Slack Socket Mode bridge daemon: command parsing and authorization, tmux session hosting, thread-per-session mapping, inbound reply delivery, outbound event formatting, launchd installation.

### Modified Capabilities
- `cli-interface`: adds the `slack` command (with `start`, `install`, `remove`, `status` subcommands) and the `--remote-control` option; config assembly gains `remoteControl` and event-sink fields.
- `configuration-system`: adds the local overlay layer (`config.local.json`) and new default keys `remoteControl` and `slack`.

## Impact

- `platform/orchestrator/src/commands/cli-spawn.js`: `--remote-control`, `--settings` hook injection, tmux wrapping.
- `platform/orchestrator/src/commands/run.js`, `talk.js`, `pair.js`, `kickoff.js`: lifecycle event emission, pass-through of new config.
- New: `platform/orchestrator/src/hooks/emit-event.js` (hook command), `platform/orchestrator/src/events/` (event schema, sink client), `platform/orchestrator/src/slack/` (socket-mode client, command parser, bridge, tmux host, formatter), `platform/orchestrator/src/commands/slack.js`.
- `platform/orchestrator/src/index.js`: new command and option, help text.
- `platform/orchestrator/config/defaults.json`, `infra/config.js`: new keys and overlay.
- `platform/orchestrator/src/scheduler/plist-template.js`: plist variant for the bridge daemon.
- `.gitignore`: `config.local.json`.
- System dependencies: `tmux` (Homebrew) becomes required when `slack.enabled` is set; Claude Code 2.1.200+ for Remote Control naming; a claude.ai login (not an API key) for Remote Control.
- README, `llms.txt`, roadmap, CLI help.
