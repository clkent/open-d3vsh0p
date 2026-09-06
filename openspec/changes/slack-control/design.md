# Design: slack-control

## Context

All four interactive commands spawn `claude` with `stdio: 'inherit'` (`cli-spawn.js`). The orchestrator never reads the session's output and has no write path into it; the only session signals it consumes today are transcript-file mtimes (`limit-resume.js`) and process exit. Claude Code offers three mechanisms relevant to remote interaction, verified against the current docs and the installed CLI (2.1.263):

| Mechanism | What it gives | Constraints |
|---|---|---|
| Remote Control (`--remote-control [name]`) | Full two-way chat with the *same* local session from the Claude iOS/Android app or claude.ai, terminal stays interactive, push notifications for questions and permission prompts, `AskUserQuestion` forwarded and held open | Requires claude.ai login (not `ANTHROPIC_API_KEY`); one remote session per process; transcript stored on Anthropic servers while connected |
| Hooks + `--settings` | `Stop` (with `last_assistant_message`), `Notification` (matchers incl. `idle_prompt`, `permission_prompt`, `agent_needs_input`, `elicitation_dialog`), `SessionEnd` (reason), `PreToolUse` per tool; `--settings '<json>'` overrides settings keys per session | `--settings` overrides a key wholesale, so injected `hooks` may shadow the project's own hooks (must merge) |
| Channels (`--channels`, MCP `claude/channel`) | External service pushes messages into the running session as user turns | Research preview; no Slack plugin; custom servers need `--dangerously-load-development-channels`, which prompts for confirmation at launch; flag syntax may change; requires `@modelcontextprotocol/sdk` |

There is no documented IPC for injecting a user message into a running interactive session; writing to its terminal is the only general path. tmux 3.6a is installed via Homebrew. Project conventions require zero production npm dependencies; Node 24 provides `WebSocket`, `fetch`, and `process.loadEnvFile` in the standard library.

## Goals / Non-Goals

**Goals:**
- Start `run`, `talk`, `pair`, `kickoff` and query `status` from Slack on a phone.
- Be told, in Slack, when a session asks a question, hits a permission prompt, goes idle, or ends, and what Morgan's summary was.
- Reply from a Slack thread and have the text land in the right session.
- Keep the existing terminal experience unchanged when the feature is off.
- No new npm dependencies; no public network exposure of the Mac.

**Non-Goals:**
- Replacing the terminal as the primary UI or streaming every tool call to Slack.
- A general Slack channel MCP server or Channels-based integration (revisit when Channels leaves preview and lists Slack).
- Multi-user or multi-machine operation; the bridge serves one operator on one Mac.
- Driving the REST API or web dashboard from Slack.

## Decisions

### D1: Remote Control is the answer to "chat with the agent from my phone"; Slack is the answer to "operate d3vsh0p from my phone"
Remote Control already delivers the richest phone chat possible (full transcript, images, question dialogs, push) for one flag, so it ships first and is recommended as the default way to *converse* with a session. Slack is where d3vsh0p adds value: starting sessions, routing lifecycle events the CLI itself does not know about (limit waits, idle continues, consolidation), and a durable per-session thread. The Slack thread also mirrors turn-ending messages, so light chat works there too, but Remote Control is the fallback whenever the Slack path is lossy (see D5).

Alternatives: Channels (rejected for now: preview gating, no Slack plugin, launch-time confirmation prompt breaks scripted spawns, SDK dependency). Claude in Slack / Claude Tag (rejected: spawns cloud sessions, cannot reach the local terminal).

### D2: Slack Socket Mode with a zero-dependency client
The bridge calls `apps.connections.open` with the app-level token, opens the returned `wss://` URL with Node's global `WebSocket`, acknowledges every envelope by `envelope_id` within Slack's 3-second window, and reconnects on `disconnect` envelopes or socket close with backoff. It handles `events_api` envelopes for `message` (DM) and `app_mention`, and `slash_commands` for `/devshop`. Outbound uses `chat.postMessage` via `fetch`. Socket Mode needs no inbound port, no ngrok, and no request-signature verification. Slack Bolt is not used (npm dependency).

### D3: Sessions run inside tmux when Slack is enabled
`spawnClaudeTerminal` gains a `host` option. With `host: 'tmux'`, it runs `tmux new-session -A -s devshop-<projectId>-<type> [-d] -- claude <args>`. From a terminal the call attaches in the foreground, so the operator sees the normal interactive session (inside tmux). From the bridge it runs detached. Slack replies are delivered with `tmux send-keys -t <session> -l -- <text>` followed by `Enter`, which never passes through a shell. Session names are derived from registry IDs (validated `[a-z0-9-]+`) so they are safe as tmux targets. `stop` sends `/exit` then, after a grace period, `C-c`, so the orchestrator's normal post-session path (health check, consolidation) still runs. tmux hosting is off unless `slack.enabled` is true, preserving today's UX by default.

Alternatives: `node-pty` (npm dependency, and the orchestrator would have to proxy the terminal); `open -a Terminal` wrapper (visible window but no input path); `-p --input-format stream-json` headless mode (loses the interactive terminal the platform just moved to, and disables `AskUserQuestion`).

### D4: Events flow over localhost HTTP to whichever sink is running
A single event schema `{ ts, type, projectId, sessionType, claudeSessionId, ...data }` is used by both hooks and the orchestrator. Emitters POST to `http://127.0.0.1:<port>/events` where the port comes from `slack.port` (default 3211); the bridge writes `active-agents/slack/bridge.json` (`{ port, pid, startedAt }`) so emitters can also discover it. A missing or refused sink is a silent no-op with a 500 ms timeout, so hooks never slow or break a session. The hook command is `node platform/orchestrator/src/hooks/emit-event.js <hookEvent>`; it reads the hook JSON from stdin, maps it to the schema, POSTs, and always exits 0. Orchestrator-side emitters live in `events/session-events.js` and are called from `run.js` at the existing lifecycle points (spawn, limit wait start/resume, nudge, session complete, health failed, consolidation result, HUMAN items).

Alternatives: hooks posting straight to Slack (no thread state; secrets in every hook process); a spool file the bridge tails (works offline but adds file-watching and cleanup); a Unix socket (fine, but HTTP is simpler to test with `curl`).

### D5: Hook set and Slack rendering
- `Stop` → post `last_assistant_message` (truncated to 3,000 characters with a "see terminal" note) into the session thread. In `run` mode a `Stop` is itself "Morgan stopped working", so it is posted with a stop marker; the orchestrator's idle-continuation event follows if it fires.
- `Notification` with matcher `idle_prompt|permission_prompt|agent_needs_input|elicitation_dialog` → post an alert with the notification message.
- `PreToolUse` matcher `AskUserQuestion` → post the question and its options; the hook allows the tool (no decision returned). Answering from Slack is best-effort: the bridge sends `Escape` to dismiss the picker, then types the reply as a normal message. Remote Control is the reliable path for option dialogs and the thread post says so.
- `SessionEnd` → post the reason and close the thread mapping.
Hooks are injected as `--settings '{"hooks": {...}}'`. Because `--settings` overrides the `hooks` key wholesale, the spawn helper reads the project's `.claude/settings.json` and `.claude/settings.local.json`, merges any existing hooks arrays with the injected ones, and passes the union. Spike task 1.1 verifies this override behavior on the installed CLI before the rest is built.

### D6: Authorization and input safety
`slack.allowedUserIds` must be non-empty for the bridge to start; every inbound envelope is checked against it and unmatched senders are dropped and logged, never answered. Commands are parsed against a fixed grammar; project arguments are resolved through the registry, never passed to a shell. Free text is only accepted inside a thread the bridge created and is delivered literally via tmux. The event sink binds to 127.0.0.1 only and accepts a bearer token generated at bridge start and written to `bridge.json` (mode 0600), which emitters read; this stops other local processes from posting fake events.

### D7: Thread-per-session mapping
The bridge keeps `{ threadKey → { projectId, sessionType, tmuxSession, claudeSessionId } }` in memory and persists it to `active-agents/slack/threads.json` so a restart can keep routing replies to sessions that are still alive (checked with `tmux has-session`). A session started from a terminal (not from Slack) still gets a thread the first time an event for it arrives.

### D8: Configuration
`defaults.json` gains `remoteControl: { enabled: false }` and `slack: { enabled: false, allowedUserIds: [], channel: null, port: 3211, tmux: true }`. `loadConfig` merges `defaults.json` → `<root>/config.local.json` (gitignored) → per-project overrides. Tokens `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are read from `<root>/.env` with `process.loadEnvFile` (missing file is fine when Slack is disabled). `--remote-control` on the CLI overrides the config for one session.

### D9: Daemon lifecycle
`devshop slack start` runs in the foreground (for debugging); `devshop slack install` writes `~/Library/LaunchAgents/com.devshop.slack-bridge.plist` (KeepAlive, RunAtLoad, logs under `active-agents/slack/logs/`) using the existing plist builder with a new program-argument variant; `remove` and `status` mirror the scheduler commands. The bridge must run with a login-session environment so `claude`, `tmux`, `gh`, and `node` resolve; the plist sets `PATH` explicitly from the installing shell.

## Risks / Trade-offs

- [`--settings` may not merge hooks the way the docs imply, or may reject the `hooks` key] → Spike 1.1 tests it first; fallback is writing the hooks into the project's `.claude/settings.local.json` (gitignored in projects) with a marker so they can be removed.
- [tmux changes terminal ergonomics: scrollback, copy mode, Ctrl+C passthrough] → Off by default; documented; `slack.tmux: false` keeps terminal sessions bare (Slack then gets outbound events only for those sessions, and Remote Control covers chat).
- [Answering `AskUserQuestion` pickers by keystroke is fragile] → Treated as best-effort with the Escape-then-type fallback; the Slack post links the operator to Remote Control for option dialogs.
- [Hook output volume: `Stop` fires on every turn in chatty talk/pair sessions] → Per-thread rate limit (coalesce posts within 2 s, cap message length); Slack's `chat.postMessage` rate limits are respected with retry-after.
- [Slack Socket Mode disconnects periodically by design] → Reconnect loop with jittered backoff; `warning`/`disconnect` envelopes handled; missed inbound messages while reconnecting are acceptable for this use.
- [Bridge dies while sessions keep running] → Sessions are unaffected (tmux-hosted, hooks no-op); `threads.json` lets a restarted bridge resume routing; launchd KeepAlive restarts it.
- [Remote Control needs a claude.ai login] → Detected at spawn; if `--remote-control` fails the CLI still starts interactively and shows a failure notice, so the run is not blocked.
- [Secrets] → Tokens only in `.env`; never logged; hook processes receive only the sink URL and bearer token via environment.
- [Mac asleep] → Same limitation as scheduled runs; documented (`caffeinate`).

## Migration Plan

1. Ship `remote-control-sessions` (config + flag). No behavior change unless enabled.
2. Ship `session-event-hooks` behind the sink no-op; sessions run as before when nothing listens.
3. Ship `slack-control`; operator creates the Slack app (manifest checked into `docs/slack-app-manifest.json`), fills `.env` and `config.local.json`, runs `devshop slack start`, then `install`.
Rollback: set `slack.enabled: false` (removes tmux hosting and hook injection) and `devshop slack remove`.

## Open Questions

- Should `Stop` messages in `run` mode be posted in full, or only the first paragraph with a "more" link to the terminal? Start with full up to the cap and tune from field use.
- Should `kickoff` be allowed from Slack at all, given it scaffolds a repo and runs a multi-turn Q&A? Included, with a confirmation reply required before scaffolding.
- Slash command (`/devshop run my-app`) versus DM grammar (`run my-app`): both are cheap over Socket Mode; the DM grammar is primary because it works from the app's DM view without typing a slash.
