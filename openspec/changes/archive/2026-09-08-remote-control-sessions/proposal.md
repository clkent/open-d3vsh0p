# Proposal: remote-control-sessions

> **Scope change, 2026-09-08.** Only the first bullet below shipped (`remote-control-sessions`, PR #52). The control server, detached tmux launcher, and launchd installation (`remote-control-server`) were built on a branch, reviewed, and deliberately **not merged**: sessions started at the terminal are already reachable from the Claude app, and an always-on, phone-driven entry point that starts permission-skipping agents was judged more exposure than value at this stage. The branch and its PR were closed; nothing from it is on main. The capability is deferred, not archived as done.

## Why

Every d3vsh0p session (kickoff, talk, run, pair) is an interactive Claude Code CLI bound to a terminal on one Mac. Once the operator walks away there is no way to start a run, answer a question Riley or Morgan asks, or learn that Morgan stopped, other than sitting back down at that terminal. Claude Code's built-in Remote Control already connects a local session to the Claude mobile app with full transcript sync, forwarded question dialogs, and push notifications, so the cheapest way to make d3vsh0p phone-operable is to turn that on for every session and add a thin launcher for starting sessions remotely. A Slack bridge was evaluated and rejected: it would re-implement, with less fidelity, what Remote Control provides.

## What Changes

- **Remote Control on interactive sessions.** A `remoteControl.enabled` config key and a `--remote-control` CLI option start every spawned Claude Code session with `--remote-control <name>`, named after the agent and project, so it appears in the Claude app's Code tab. Respawns after usage-limit waits and idle continuations keep the flag. A Remote Control failure never blocks the session.
- **Control server.** A new `devshop remote` command manages a persistent `claude remote-control` server that runs in a dedicated control directory (`active-agents/remote/`) with a generated CLAUDE.md. From the phone the operator opens the control session and asks it to run, talk, pair, kickoff, check status, list sessions, or stop a project; the control session executes deterministic `devshop remote` subcommands rather than composing shell commands itself.
- **Detached launch into tmux.** `devshop remote launch <command> <project> [--resume]` starts the orchestrator command inside a named, detached tmux session (`devshop-<project>-<command>`) with `--remote-control`, so a session started from the phone has a real terminal and shows up in the app on its own. `devshop remote sessions` lists them and `devshop remote stop <project>` ends one gracefully through the orchestrator's normal post-session path. The operator can `tmux attach` from the laptop at any time.
- **launchd installation.** `devshop remote install` writes and loads a KeepAlive launchd agent that runs the control server inside tmux (server mode needs a terminal); `remove` and `status` mirror the scheduler commands.
- **Local config overlay.** A gitignored `config.local.json` at the d3vsh0p root, merged between `defaults.json` and per-project overrides, holds machine-level settings such as `remoteControl.enabled`.

Not in scope: a Slack or Channels integration, pushing orchestrator lifecycle events (limit waits, idle continues, run summaries) to the phone as notifications (the control session answers status questions on request), and any change to the terminal experience when Remote Control is off.

## Capabilities

### New Capabilities
- `remote-control-sessions`: interactive sessions start with Claude Code Remote Control enabled via config or CLI flag, named per agent and project, including respawns.
- `remote-control-server`: the `devshop remote` command family: control directory and generated CLAUDE.md, control server start and launchd install, detached tmux launch of orchestrator commands, session listing and graceful stop.

### Modified Capabilities
- `cli-interface`: adds the `remote` command (subcommands `start`, `install`, `remove`, `status`, `launch`, `sessions`, `stop`) and the `--remote-control` option; config assembly gains `remoteControl`.
- `configuration-system`: adds the local overlay layer (`config.local.json`) and the `remoteControl` default.

## Impact

- `platform/orchestrator/src/commands/cli-spawn.js`: `--remote-control` arg.
- `platform/orchestrator/src/commands/run.js`, `talk.js`, `pair.js`, `kickoff.js`: resolve and pass the Remote Control setting.
- New: `platform/orchestrator/src/commands/remote.js`, `platform/orchestrator/src/remote/` (tmux launcher, control-dir generator), `templates/agents/remote-control/control-claude.md`.
- `platform/orchestrator/src/index.js`: new command and option, help text.
- `platform/orchestrator/config/defaults.json`, `infra/config.js`: `remoteControl` key and overlay.
- `platform/orchestrator/src/scheduler/plist-template.js`: plist variant for the control server.
- `.gitignore`: `config.local.json`.
- System dependencies: `tmux` (Homebrew) for remote launches and the control server; Claude Code 2.1.200+ for server-mode resume flags; a claude.ai login (not an API key) for Remote Control.
- README, `llms.txt`, roadmap, CLI help.
