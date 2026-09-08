## 1. Spikes (verify before building)

- [ ] 1.1 Verify `claude --remote-control "<name>"` starts under the current login, the session appears in the Claude app under that name, and an `AskUserQuestion` from Morgan is answerable from the phone
- [x] 1.2 Verify what the app shows when the run loop respawns Morgan with `--resume` (same remote session or a new entry); record the result in design.md and README — same session, same chat window
- [ ] 1.3 Verify `claude remote-control --spawn session` starts inside a launchd-launched tmux session with the claude.ai login and `PATH` available, and that the app can open the control session; capture the exit behavior after a forced network drop and confirm `--continue` resumes it

## 2. Configuration

- [x] 2.1 Add `remoteControl` (`enabled`, `serverName`) to `config/defaults.json`
- [x] 2.2 Add the `config.local.json` overlay to `infra/config.js` (defaults → overlay → project) with a descriptive error on malformed JSON; add `config.local.json` to `.gitignore`
- [x] 2.3 Tests for overlay merge order, missing and malformed overlay

## 3. Remote Control Sessions

- [x] 3.1 `buildClaudeArgs` gains `remoteControl` and emits `--remote-control <name>` when set
- [x] 3.2 Add `--remote-control` to `parseArgs` and config assembly (`remoteControl: true | null`); resolve the effective value in `run`, `talk`, `pair`, `kickoff` from CLI flag then `loadConfig`
- [x] 3.3 Ensure run-loop respawns (limit resume, nudge) pass the same `remoteControl` value and name
- [x] 3.4 Tests for args, flag precedence, respawn; update CLI help text

## 4. Control Server (dropped 2026-09-08)

The control directory, tmux launcher, `remote start/install/remove/status`, and their docs were implemented on branch `feat/remote-control-server` (PR #55) and closed without merging. See the scope note in proposal.md. Nothing from these sections is on main.
