## 1. Spikes (verify before building)

- [ ] 1.1 Verify on the installed CLI that `--settings '{"hooks":{...}}'` registers hooks for the session and whether it replaces or merges with the project's `hooks`; record the result in design.md and adjust the merge strategy
- [ ] 1.2 Verify the `Stop` hook payload carries `last_assistant_message` and the `PreToolUse` payload for `AskUserQuestion` carries the question and options; capture sample payloads as test fixtures
- [ ] 1.3 Verify `claude --remote-control "<name>"` starts under the current login and that `tmux new-session -A ... claude` attached in the foreground behaves like a bare spawn (Ctrl+C, /exit, exit code)
- [ ] 1.4 Verify `tmux send-keys -l` delivers text into a running Claude session and that `Escape` dismisses an open `AskUserQuestion` picker

## 2. Configuration

- [ ] 2.1 Add `remoteControl` and `slack` keys to `config/defaults.json`
- [ ] 2.2 Add the `config.local.json` overlay to `infra/config.js` (defaults → overlay → project) with a descriptive error on malformed JSON; add `config.local.json` to `.gitignore`
- [ ] 2.3 Add Slack token loading (`process.loadEnvFile` fallback to root `.env`) in `infra/slack-env.js`, never logging values
- [ ] 2.4 Tests for overlay merge order, missing and malformed overlay, token fallback

## 3. Remote Control Sessions

- [ ] 3.1 `buildClaudeArgs` gains `remoteControl` and emits `--remote-control <name>` when set
- [ ] 3.2 Add `--remote-control` to `parseArgs` and config assembly (`remoteControl: true | null`); resolve the effective value in `run`, `talk`, `pair`, `kickoff` from CLI flag then `loadConfig`
- [ ] 3.3 Ensure run-loop respawns (limit resume, nudge) pass the same `remoteControl` value
- [ ] 3.4 Tests for args, flag precedence, respawn; update CLI help text and README

## 4. Session Events

- [ ] 4.1 Create `events/event-schema.js` (types, validation) and `events/sink-client.js` (discovery via `DEVSHOP_EVENT_SINK` then `active-agents/slack/bridge.json`, bearer token, 500 ms timeout, silent no-op)
- [ ] 4.2 Create `hooks/emit-event.js`: read stdin, map `Stop`, `Notification`, `SessionEnd`, `PreToolUse(AskUserQuestion)` to schema, POST, always exit 0, no stdout
- [ ] 4.3 Add hook injection to `cli-spawn.js`: build the hooks object with absolute command paths, merge with the project's `.claude/settings.json` and `.claude/settings.local.json` hooks, pass as `--settings` JSON only when emission is enabled
- [ ] 4.4 Create `events/session-events.js` and emit run-lifecycle events from `run.js` (session_started, limit_wait, limit_resumed, idle_continued, health_failed, run_complete, consolidated, action_required); emit `session_started` from `talk`, `pair`, `kickoff`
- [ ] 4.5 Tests: schema validation, sink no-op when down, hook mapping from fixtures, hook merge with project hooks, `--settings` omitted when disabled, run.js emission points

## 5. tmux Session Hosting

- [ ] 5.1 Create `slack/tmux-host.js`: session naming from validated project ID and type, `newSession({ detached })`, `hasSession`, `sendText` (`send-keys -l` then `Enter`), `sendKey` (`Escape`, `C-c`), `listSessions`
- [ ] 5.2 `spawnClaudeTerminal` gains `host: 'tmux' | 'direct'` and, for tmux, runs `tmux new-session -A -s <name> [-d] -- claude <args>` returning the same `{ promise, proc }` shape
- [ ] 5.3 Select the host in `run`, `talk`, `pair`, `kickoff` from `slack.enabled && slack.tmux`
- [ ] 5.4 Tests with a mocked `tmux` binary: naming, detached vs attached args, literal send-keys, missing session handling

## 6. Slack Bridge

- [ ] 6.1 Create `slack/socket-mode-client.js`: `apps.connections.open`, global `WebSocket`, envelope ack, `disconnect` handling, jittered backoff reconnect; `slack/web-api.js` for `chat.postMessage`, `reactions.add`, `conversations.open` with 429 retry
- [ ] 6.2 Create `slack/command-parser.js`: grammar for `run`, `talk`, `pair`, `kickoff`, `status`, `stop`, `sessions`, `help`; registry-based project resolution; help text
- [ ] 6.3 Create `slack/thread-store.js`: in-memory map persisted to `active-agents/slack/threads.json`, restart pruning via `tmux has-session`
- [ ] 6.4 Create `slack/event-formatter.js`: render each event type to Slack text per spec (truncation, numbered options, Remote Control note, run summary block), 2 s coalescing per thread
- [ ] 6.5 Create `slack/bridge.js`: authorization check, command execution (spawn `node index.js <cmd> <project>` inside tmux via `tmux-host`, duplicate-session guard, kickoff confirmation), thread reply delivery (Escape-before-text after a `question`), `stop` flow (`/exit`, 30 s, `C-c`), `status` reply, local event sink HTTP server on 127.0.0.1 with bearer token, `bridge.json` lifecycle
- [ ] 6.6 Create `commands/slack.js` with `start`, `install`, `remove`, `status`; add `slack` to `index.js` dispatch and help; plist variant in `plist-template.js` (`com.devshop.slack-bridge`, KeepAlive, RunAtLoad, PATH, logs)
- [ ] 6.7 Tests: parser grammar and rejection cases, authorization drop, envelope ack and reconnect (mock WebSocket), formatter output per event type, thread store persistence and pruning, sink 401, stop flow timing (fake timers), plist contents

## 7. Documentation and Rollout

- [ ] 7.1 Add `docs/slack-app-manifest.json` (Socket Mode, scopes `chat:write`, `im:history`, `im:read`, `im:write`, `app_mentions:read`, `reactions:write`, `commands`; events `message.im`, `app_mention`; slash command `/devshop`) and a setup walkthrough in README (create app, tokens into `.env`, `config.local.json`, `devshop slack start`, `install`)
- [ ] 7.2 README sections for Remote Control, Slack control, tmux hosting trade-offs, and `caffeinate` note; update `llms.txt`
- [ ] 7.3 Update `openspec/project.md` pending requirements and `openspec/roadmap.md` Phase XX entries; mark items complete as each capability lands
- [ ] 7.4 End-to-end check: from the phone, `run <project>` starts a session, a `Stop` message appears in the thread, a thread reply reaches the session, `stop` produces a run summary, and Remote Control opens the same session in the Claude app
