## ADDED Requirements

### Requirement: Slack Bridge Daemon
The system SHALL provide a `devshop slack start` command that runs a long-lived bridge process connecting to Slack via Socket Mode using only Node standard-library `WebSocket` and `fetch`. The bridge SHALL refuse to start unless `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are set (from the environment or `<devshopRoot>/.env`) and `slack.allowedUserIds` is non-empty, printing which prerequisite is missing. On start it SHALL write `active-agents/slack/bridge.json` (`{ port, pid, token, startedAt }`, file mode 0600) and remove it on clean exit.

#### Scenario: Missing allowlist
- **WHEN** `devshop slack start` runs with an empty `slack.allowedUserIds`
- **THEN** it SHALL exit 1 with a message naming `slack.allowedUserIds`

#### Scenario: Socket Mode handshake
- **WHEN** the bridge starts with valid tokens
- **THEN** it SHALL call `apps.connections.open`, connect to the returned WebSocket URL, and acknowledge each envelope by `envelope_id` before processing it

#### Scenario: Reconnect
- **WHEN** Slack sends a `disconnect` envelope or the socket closes
- **THEN** the bridge SHALL reconnect with jittered exponential backoff (1 s to 60 s) without exiting

### Requirement: Sender Authorization
The bridge SHALL process an inbound message only when the Slack user ID is in `slack.allowedUserIds`. Messages from any other user SHALL be dropped without a reply and logged with the user ID. Bot-authored messages (including the bridge's own) SHALL be ignored.

#### Scenario: Unauthorized user
- **WHEN** a DM arrives from a user ID not in the allowlist
- **THEN** the bridge SHALL not reply, not run any command, and log `unauthorized_sender`

### Requirement: Command Grammar
The bridge SHALL accept these commands from an allowlisted user, as a DM, an `@mention`, or the `/devshop` slash command: `run <project> [--resume]`, `talk <project>`, `pair <project> [--resume]`, `kickoff <name>`, `status <project>`, `stop <project>`, `sessions`, and `help`. `<project>` SHALL be resolved through the project registry exactly as the CLI does; an unknown project SHALL produce a reply listing registered projects. Any text that is not a recognized command and is not in a session thread SHALL produce the help text. Arguments SHALL never be interpolated into a shell command.

#### Scenario: Run from a DM
- **WHEN** an allowlisted user DMs `run my-app`
- **THEN** the bridge SHALL start a `run` session for the resolved project and reply in a new thread with the session header

#### Scenario: Unknown project
- **WHEN** an allowlisted user DMs `run nope`
- **THEN** the bridge SHALL reply with an error and the list of registered project names, and start nothing

#### Scenario: Duplicate session
- **WHEN** `run my-app` is received while a `devshop-my-app-run` tmux session already exists
- **THEN** the bridge SHALL reply with a link to the existing thread and start nothing

#### Scenario: Kickoff requires confirmation
- **WHEN** an allowlisted user DMs `kickoff new-app`
- **THEN** the bridge SHALL reply asking for `yes` in the thread and SHALL scaffold only after receiving it

### Requirement: tmux Session Hosting
When `slack.enabled` is true, `spawnClaudeTerminal` SHALL run the Claude CLI inside a tmux session named `devshop-<projectId>-<type>`. Sessions started by the bridge SHALL be detached; sessions started from a terminal SHALL attach in the foreground so the operator sees the interactive session. The session name SHALL be derived only from the registry project ID (matching `^[a-z0-9-]+$`) and the session type. When `slack.enabled` is false, sessions SHALL be spawned exactly as before (no tmux).

#### Scenario: Bridge-started session is detached
- **WHEN** the bridge starts `run my-app`
- **THEN** a detached tmux session `devshop-my-app-run` SHALL exist running the orchestrator `run` command

#### Scenario: Terminal-started session attaches
- **WHEN** `./devshop pair my-app` runs in a terminal with `slack.enabled: true`
- **THEN** the terminal SHALL be attached to tmux session `devshop-my-app-pair` for the duration of the session and the command SHALL return the CLI exit code when the session ends

#### Scenario: Slack disabled
- **WHEN** `slack.enabled` is false
- **THEN** `spawnClaudeTerminal` SHALL spawn `claude` directly with `stdio: 'inherit'`

### Requirement: Thread Per Session
The bridge SHALL create one Slack thread per session (in the DM or the configured `slack.channel`) and maintain a mapping from thread to `{ projectId, sessionType, tmuxSession, claudeSessionId }`, persisted to `active-agents/slack/threads.json`. Events for a session that has no thread yet (for example, a terminal-started session) SHALL create one. On restart the bridge SHALL reload the mapping and drop entries whose tmux session no longer exists.

#### Scenario: Terminal-started session gets a thread
- **WHEN** a `session_started` event arrives for `my-app` `pair` and no thread is mapped
- **THEN** the bridge SHALL post a new parent message and map its thread to that session

#### Scenario: Restart pruning
- **WHEN** the bridge restarts and `threads.json` references `devshop-old-app-run` which no longer exists in tmux
- **THEN** that entry SHALL be removed and a closing note posted to its thread

### Requirement: Inbound Reply Delivery
Free text posted by an allowlisted user in a mapped thread SHALL be delivered to that session with `tmux send-keys -t <session> -l -- <text>` followed by `Enter`. If the most recent event for the session was a `question`, the bridge SHALL send `Escape` first, then the text. Delivery SHALL be confirmed with a reaction on the Slack message; a missing tmux session SHALL produce a reply saying the session has ended.

#### Scenario: Reply lands in the session
- **WHEN** the user replies `focus on the auth bug first` in the thread for `devshop-my-app-run`
- **THEN** the bridge SHALL send that exact text literally to the tmux session, then `Enter`, and react to the Slack message

#### Scenario: Session gone
- **WHEN** the user replies in a thread whose tmux session no longer exists
- **THEN** the bridge SHALL reply that the session has ended and suggest `run <project> --resume`

### Requirement: Outbound Event Rendering
The bridge SHALL render received events into the session thread: `assistant_stop` as the message text (truncated to 3,000 characters with a note to see the terminal); `question` as the question and numbered options with a note that option dialogs are best answered via Remote Control; `notification` as an alert with the notification message; `limit_wait`, `limit_resumed`, `idle_continued`, `health_failed`, `consolidated`, `action_required` as one-line status posts; `run_complete` as a summary block (completed, parked, remaining, stop reason); `session_ended` as a closing post. Posts to the same thread within 2 seconds SHALL be coalesced, and Slack `429` responses SHALL be retried after the `Retry-After` interval.

#### Scenario: Question rendered
- **WHEN** a `question` event with two options arrives
- **THEN** the thread SHALL receive the question text, `1.` and `2.` options, and the Remote Control note

#### Scenario: Run summary rendered
- **WHEN** a `run_complete` event arrives
- **THEN** the thread SHALL receive a post containing the completed, parked, and remaining counts and the stop reason

### Requirement: Session Stop From Slack
`stop <project>` SHALL send `/exit` to every tmux session for that project, wait up to 30 seconds for the tmux session to end, then send `C-c` if it is still alive, so the orchestrator's normal post-session path (health check, summary, consolidation) runs.

#### Scenario: Graceful stop
- **WHEN** `stop my-app` is received and `devshop-my-app-run` exists
- **THEN** the bridge SHALL send `/exit`, and the run's `run_complete` event SHALL subsequently be posted to the thread

### Requirement: Status From Slack
`status <project>` SHALL reply with the same roadmap counts as `devshop status` (total, completed, pending, parked) plus the live tmux sessions for the project and, for a running `run`, the last event type and time.

#### Scenario: Status reply
- **WHEN** `status my-app` is received
- **THEN** the reply SHALL include total, completed, pending, and parked item counts and any active session names

### Requirement: Bridge Installation as a launchd Agent
`devshop slack install` SHALL write and load `~/Library/LaunchAgents/com.devshop.slack-bridge.plist` running `node <orchestrator>/src/index.js slack start` with `RunAtLoad` and `KeepAlive` true, `PATH` set from the installing shell, and stdout/stderr under `active-agents/slack/logs/`. `devshop slack remove` SHALL unload and delete it. `devshop slack status` SHALL report whether the plist is loaded, whether the bridge is reachable on its port, and the mapped sessions.

#### Scenario: Install
- **WHEN** `devshop slack install` runs
- **THEN** the plist SHALL exist, `launchctl` SHALL report it loaded, and `devshop slack status` SHALL report the bridge reachable within 10 seconds

#### Scenario: Remove
- **WHEN** `devshop slack remove` runs
- **THEN** the plist SHALL be unloaded and deleted and `bridge.json` removed
