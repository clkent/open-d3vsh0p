## 1. Spikes (verify before building)

- [x] 1.1 Verify `claude --remote-control "<name>"` starts under the current login, the session appears in the Claude app under that name, and an `AskUserQuestion` from Morgan is answerable from the phone
- [ ] 1.2 Verify what the app shows when the run loop respawns Morgan with `--resume` (same remote session or a new entry); record the result in design.md and README
- [x] 1.3 Verify `claude remote-control --spawn session` starts inside a launchd-launched tmux session with the claude.ai login and `PATH` available, and that the app can open the control session; capture the exit behavior after a forced network drop and confirm `--continue` resumes it

## 2. Configuration

- [x] 2.1 Add `remoteControl` (`enabled`, `serverName`) to `config/defaults.json`
- [x] 2.2 Add the `config.local.json` overlay to `infra/config.js` (defaults → overlay → project) with a descriptive error on malformed JSON; add `config.local.json` to `.gitignore`
- [x] 2.3 Tests for overlay merge order, missing and malformed overlay

## 3. Remote Control Sessions

- [x] 3.1 `buildClaudeArgs` gains `remoteControl` and emits `--remote-control <name>` when set
- [x] 3.2 Add `--remote-control` to `parseArgs` and config assembly (`remoteControl: true | null`); resolve the effective value in `run`, `talk`, `pair`, `kickoff` from CLI flag then `loadConfig`
- [x] 3.3 Ensure run-loop respawns (limit resume, nudge) pass the same `remoteControl` value and name
- [x] 3.4 Tests for args, flag precedence, respawn; update CLI help text

## 4. Control Directory and Template

- [x] 4.1 Create `templates/agents/remote-control/control-claude.md` (what d3vsh0p is, project list placeholder, allowed actions, how to answer status and stop questions, never compose tmux/claude commands)
- [x] 4.2 Create `remote/control-dir.js`: render CLAUDE.md from the registry and write `.claude/settings.json` with the narrow allow list into `active-agents/remote/`
- [x] 4.3 Tests: rendered project list, allow list contents, regeneration overwrites stale content

## 5. Launcher, Sessions, Stop

- [x] 5.1 Create `remote/tmux.js`: session naming from validated project ID and command, `newSession` (detached, argv array), `hasSession`, `listSessions` (with age), `sendText` (`send-keys -l` then `Enter`), `sendKey` (`C-c`), `killSession`
- [x] 5.2 Implement `remote launch` (command validation, registry resolution, kickoff name validation, duplicate refusal, output with tmux and app session names)
- [x] 5.3 Implement `remote sessions` and `remote stop` (`/exit`, 30 s wait, `C-c`, report)
- [x] 5.4 Tests with a mocked `tmux` binary: naming, argv construction (no shell), duplicate refusal, invalid command, unknown project, stop timing with fake timers

## 6. Control Server and launchd

- [x] 6.1 Implement `remote start`: regenerate the control directory, run `claude remote-control --name <serverName> --spawn session` in it, restart loop with backoff and `--continue`, stop on SIGINT/SIGTERM or an account-unavailable exit
- [x] 6.2 Add a plist variant to `plist-template.js` for `com.devshop.remote` (tmux-wrapped `remote start`, KeepAlive, RunAtLoad, PATH, logs); implement `remote install`, `remove`, `status`
- [x] 6.3 Create `commands/remote.js` and wire `remote` into `index.js` dispatch and help
- [x] 6.4 Tests: restart loop (mock spawn, fake timers), account-unavailable exit, plist contents, status reporting

## 7. Documentation and Rollout

- [x] 7.1 README: "Use from your phone" section (enable Remote Control, `/config` push settings, `devshop remote start` then `install`, what the control session can do, `tmux attach` from the laptop, claude.ai login requirement, respawn behavior from spike 1.2, `caffeinate` note); update `llms.txt`
- [x] 7.2 Update `openspec/project.md` pending requirements and `openspec/roadmap.md` Phase XX entries; mark items complete as each capability lands
- [ ] 7.3 End-to-end check from the phone: open the control session, ask it to run a project, find the Morgan session in the app, answer a question there, ask the control session for status, stop the run and confirm the run summary appears in the tmux session
