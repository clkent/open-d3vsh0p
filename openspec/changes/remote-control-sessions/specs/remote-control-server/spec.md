## ADDED Requirements

### Requirement: Control Directory
The system SHALL maintain a control directory at `active-agents/remote/` containing a generated `CLAUDE.md` rendered from `templates/agents/remote-control/control-claude.md` and a `.claude/settings.json`. The CLAUDE.md SHALL describe d3vsh0p, list the registered projects (ID, name, directory), and instruct the control session to act only through `devshop remote launch|sessions|stop` and `devshop status`, never by composing `tmux` or `claude` commands. The settings file SHALL pre-approve only `Bash(<devshop>/devshop remote *)`, `Bash(<devshop>/devshop status *)`, `Bash(tmux ls)`, and read-only tools. `devshop remote start` and `devshop remote install` SHALL regenerate both files so the project list is current.

#### Scenario: Generated control CLAUDE.md
- **WHEN** `devshop remote start` runs with projects `my-app` and `other-app` registered
- **THEN** `active-agents/remote/CLAUDE.md` SHALL exist and list both projects with their IDs and directories

#### Scenario: Control permissions are narrow
- **WHEN** the control settings file is generated
- **THEN** its `permissions.allow` SHALL contain only the `devshop remote`, `devshop status`, and `tmux ls` Bash patterns plus read-only tools, and SHALL NOT contain a bare `Bash` allowance

### Requirement: Control Server Start
`devshop remote start` SHALL run `claude remote-control --name <remoteControl.serverName> --spawn session` in the control directory, in the foreground, and keep it running: when the server process exits, the command SHALL wait with exponential backoff (5 s to 5 min) and restart it with `--continue` so the same control session is resumed. It SHALL exit only on SIGINT/SIGTERM or when the server reports that Remote Control is unavailable for the account.

#### Scenario: Server restarts after exit
- **WHEN** the server process exits with a non-zero code (for example after a network-outage give-up)
- **THEN** the command SHALL log the exit, wait the current backoff, and start `claude remote-control --continue` in the control directory

#### Scenario: Unavailable account stops the loop
- **WHEN** the server exits reporting that Remote Control requires a claude.ai subscription or a full-scope login
- **THEN** the command SHALL print the reason and `claude auth login` guidance and exit 1 without restarting

### Requirement: Detached Launch
`devshop remote launch <command> <project> [--resume]` SHALL accept only `run`, `talk`, `pair`, or `kickoff` as `<command>`; resolve `<project>` through the registry for all but `kickoff`, which takes a new project name matching `^[a-z0-9-]+$`; and start `tmux new-session -d -s devshop-<projectId>-<command> -- <node> <index.js> <command> <project> --remote-control [--resume]`. It SHALL print the tmux session name and the expected app session name. If a tmux session with that name already exists it SHALL refuse with the existing name and exit 1. Arguments SHALL never be interpolated into a shell string.

#### Scenario: Launch a run
- **WHEN** `devshop remote launch run my-app` is executed and no `devshop-my-app-run` session exists
- **THEN** a detached tmux session `devshop-my-app-run` SHALL be running the orchestrator `run` command with `--remote-control`, and the output SHALL name the tmux session and `Morgan — my-app`

#### Scenario: Invalid command
- **WHEN** `devshop remote launch deploy my-app` is executed
- **THEN** the command SHALL print the allowed commands and exit 1 without starting anything

#### Scenario: Duplicate launch refused
- **WHEN** `devshop remote launch run my-app` is executed while `devshop-my-app-run` exists
- **THEN** the command SHALL exit 1 and print the existing session name and `tmux attach` hint

#### Scenario: Unknown project
- **WHEN** `devshop remote launch pair nope` is executed
- **THEN** the command SHALL print the registered project names and exit 1

### Requirement: Session Listing
`devshop remote sessions` SHALL list every tmux session whose name starts with `devshop-`, with project ID, command, and age, and SHALL print `No remote sessions` when there are none. Output SHALL be stable enough for the control session to relay verbatim.

#### Scenario: Two sessions listed
- **WHEN** `devshop-my-app-run` and `devshop-other-app-talk` exist
- **THEN** the output SHALL contain one line per session with project, command, and age

### Requirement: Graceful Stop
`devshop remote stop <project> [--command <cmd>]` SHALL send `/exit` followed by `Enter` to each matching `devshop-<projectId>-*` tmux session, wait up to 30 seconds for the session to disappear, then send `C-c` if it is still present, so the orchestrator's normal post-session path runs. It SHALL report which sessions ended and which needed `C-c`.

#### Scenario: Stop a run
- **WHEN** `devshop remote stop my-app` is executed and `devshop-my-app-run` exists
- **THEN** the command SHALL send `/exit` to that session and report it ended once the tmux session is gone

#### Scenario: Nothing to stop
- **WHEN** `devshop remote stop my-app` is executed and no matching session exists
- **THEN** the command SHALL print `No remote sessions for my-app` and exit 0

### Requirement: launchd Installation
`devshop remote install` SHALL write and load `~/Library/LaunchAgents/com.devshop.remote.plist` whose program starts `devshop remote start` inside a tmux session named `devshop-remote` (`tmux new-session -A -d -s devshop-remote -- <node> <index.js> remote start`), with `RunAtLoad` and `KeepAlive` true, `PATH` captured from the installing shell, and logs under `active-agents/remote/logs/`. `devshop remote remove` SHALL unload and delete the plist and kill the `devshop-remote` tmux session. `devshop remote status` SHALL report whether the plist is loaded, whether the `devshop-remote` tmux session exists, whether the server process is alive, the session URL parsed from the server log when available, and the current remote sessions.

#### Scenario: Install
- **WHEN** `devshop remote install` runs
- **THEN** the plist SHALL exist, `launchctl` SHALL report it loaded, and within 30 seconds `devshop remote status` SHALL report the `devshop-remote` tmux session and a live server process

#### Scenario: Remove
- **WHEN** `devshop remote remove` runs
- **THEN** the plist SHALL be unloaded and deleted and the `devshop-remote` tmux session SHALL no longer exist
