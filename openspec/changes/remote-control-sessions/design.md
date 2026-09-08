# Design: remote-control-sessions

## Context

All four interactive commands spawn `claude` with `stdio: 'inherit'` (`cli-spawn.js`); the orchestrator never reads the session's output and has no write path into it. Claude Code Remote Control, verified against the current docs and the installed CLI (2.1.263):

- **Interactive mode** (`claude --remote-control [name]`): the terminal session is also reachable from claude.ai/code and the Claude iOS/Android app. Both surfaces stay live and in sync. `AskUserQuestion` dialogs and permission prompts are forwarded and held open until answered. Push notifications fire when Claude needs a decision or a long task finishes (`/config` toggles "Push when Claude decides" and "Push when actions required"). One remote session per process. Reconnects after sleep or network loss.
- **Server mode** (`claude remote-control [--name] [--spawn same-dir|worktree|session] [--capacity] [--continue|--session-id]`): a process that serves sessions to remote devices with no local interactive session; the app can open on-demand sessions in the server's working directory. It "stays running in your terminal", shows a session URL and QR code, and exits after roughly 10 minutes of network outage.
- **Requirements**: claude.ai login (`claude auth login`); long-lived tokens from `claude setup-token` or `CLAUDE_CODE_OAUTH_TOKEN` cannot establish Remote Control. Team/Enterprise need an admin toggle; Pro/Max work as-is.
- **Limits**: local process must keep running (docs recommend tmux for headless hosts); some commands are terminal-only (`/plugin`, `/resume`).

tmux 3.6a is installed via Homebrew. Project conventions require zero production npm dependencies.

## Goals / Non-Goals

**Goals:**
- Chat with any running Riley or Morgan session from the Claude app, including answering questions and permission prompts.
- Start `run`, `talk`, `pair`, `kickoff` and get `status` from the phone without a terminal.
- Keep the terminal experience unchanged when the feature is off.
- No new npm dependencies; no public network exposure of the Mac beyond what Remote Control itself does.

**Non-Goals:**
- Slack, Channels, or any third-party chat surface.
- Pushing orchestrator lifecycle events (limit waits, nudges, run summaries) as notifications; the control session reports them on request.
- Multi-user or multi-machine operation.

## Decisions

### D1: Remote Control on every session, opt-in
`buildClaudeArgs` emits `--remote-control <name>` when the effective setting is on. The name reuses the existing `--name` value (`Morgan — my-app`, `Riley — my-app`) so sessions are identifiable in the app's list. The setting resolves as CLI `--remote-control` > project override > `config.local.json` > `defaults.json` (off). Off by default so nothing changes for users who never enable it. Respawns in the run loop (limit resume, nudge) receive the same value.

Alternative considered: Claude Code's own "Enable Remote Control for all sessions" toggle in `/config`. It works, but it is a per-machine Claude Code setting the orchestrator cannot see or name sessions through, and it also affects sessions outside d3vsh0p. The flag keeps control in d3vsh0p's config; the doc notes users may use either.

### D2: A control session, not a bot, starts sessions from the phone
Remote Control only exposes sessions that already exist, so something on the Mac must be running and reachable to launch new ones. `devshop remote start` runs `claude remote-control --name "d3vsh0p control" --spawn session` in the control directory `active-agents/remote/`. That directory contains a generated `CLAUDE.md` (from `templates/agents/remote-control/control-claude.md`) that tells the control session what d3vsh0p is, lists the registered projects, and instructs it to act only through `devshop remote launch|sessions|stop|status` and `devshop status`, never by composing `tmux` or `claude` commands itself. The control directory is separate from the repo root so the control session does not pick up the repository's development CLAUDE.md and behave like a contributor session.

Alternatives: a Slack Socket Mode bridge (rejected: re-implements chat with less fidelity, needs a daemon, event sink, and hook injection); the REST API (no phone client, and it spawns headless runs).

### D3: Deterministic launcher, tmux-hosted
`devshop remote launch <command> <project> [--resume]` validates `command` against `run|talk|pair|kickoff`, resolves `project` through the registry (kickoff takes a new name validated as `^[a-z0-9-]+$`), and runs `tmux new-session -d -s devshop-<projectId>-<command> -- <node> <index.js> <command> <project> --remote-control [--resume]`. The orchestrator process sees a real TTY inside tmux and spawns Claude exactly as it does today; no tmux code touches `cli-spawn.js`. The command prints the tmux session name and the expected app session name. A duplicate launch for an existing tmux session is refused with the existing name. `devshop remote sessions` lists `devshop-*` tmux sessions with age; `devshop remote stop <project>` sends `/exit` to the project's sessions, waits up to 30 seconds, then `C-c`, so the run's post-session path (health check, summary, consolidation) still executes. The operator can `tmux attach -t devshop-my-app-run` from a laptop to watch or type locally.

Alternative: letting the control session drive `tmux` directly via Bash. Rejected because names, argument validation, and stop semantics would live in a prompt instead of tested code.

### D4: The control server itself lives in tmux under launchd
Server mode expects a terminal (QR code on spacebar, status UI). `devshop remote install` writes `~/Library/LaunchAgents/com.devshop.remote.plist` whose program is `tmux new-session -A -d -s devshop-remote -- <node> <index.js> remote start`, with `RunAtLoad`, `KeepAlive`, an explicit `PATH` captured from the installing shell, and logs under `active-agents/remote/logs/`. Because tmux keeps running when the server exits, KeepAlive alone would not restart the server; `remote start` therefore loops: if the server process exits (for example after the 10-minute outage give-up), it waits with backoff and starts it again with `--continue` so the control session is resumed rather than recreated. `devshop remote status` reports plist loaded, tmux session present, server process alive, and the session URL parsed from the server's log.

### D5: Configuration
`defaults.json` gains `remoteControl: { enabled: false, serverName: 'd3vsh0p control' }`. `loadConfig` merges `defaults.json` → `<root>/config.local.json` (gitignored) → per-project overrides. `--remote-control` on the CLI overrides for one session.

## Risks / Trade-offs

- [Run-loop respawns after a limit wait or nudge start a new `claude` process] → Verified 2026-09-08 (spike 1.2): a `--resume` respawn reconnects as the same remote session, so the app stays in the same chat with history intact. No documentation caveat needed.
- [Server mode under launchd may not have a usable environment (`claude`, `node`, `tmux`, `gh` on PATH, keychain login)] → PATH is captured at install; spike 1.3 verifies server mode starts from a launchd-launched tmux and the claude.ai login is visible there.
- [Server mode exits after ~10 minutes of network outage] → `remote start` restart loop with `--continue`.
- [The control session has `--dangerously-skip-permissions`-free defaults and will ask for permission on Bash] → The generated control CLAUDE.md is paired with a `.claude/settings.json` in the control directory that allows only `Bash(./devshop remote *)`, `Bash(./devshop status *)`, `Bash(tmux ls)`, and read tools; nothing else is pre-approved, and other actions still prompt through the app.
- [Remote Control needs a claude.ai login; API-key users get a failure notice] → Detected at spawn; the interactive session continues locally and the run lifecycle is unchanged.
- [Transcripts of Remote Control sessions are stored on Anthropic servers while connected] → Documented; off by default.
- [Mac asleep] → Same limitation as scheduled runs; documented (`caffeinate`).

## Migration Plan

1. Ship `remote-control-sessions` (config, flag, respawn). No behavior change unless enabled.
2. Ship `remote-control-server` (`devshop remote`), then the operator runs `devshop remote start` in a terminal to try it, then `devshop remote install`.
Rollback: `devshop remote remove` and `remoteControl.enabled: false`.

## Open Questions

- Should `devshop remote launch` default `run` to `--resume` when a saved run session exists? Start explicit; revisit after field use.
- Should the control CLAUDE.md include roadmap summaries per project so status questions can be answered without a tool call? Start with `devshop status` on demand to avoid staleness.
