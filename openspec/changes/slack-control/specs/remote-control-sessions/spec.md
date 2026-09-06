## ADDED Requirements

### Requirement: Remote Control Flag on Interactive Sessions
The system SHALL start a spawned Claude Code session with `--remote-control <name>` when `remoteControl.enabled` is true in the effective configuration or `--remote-control` was passed on the command line. The name SHALL be the session display name already used for `--name` (for example `Morgan — my-app`). When neither is set, the spawn args SHALL NOT contain `--remote-control`.

#### Scenario: Enabled by config
- **WHEN** `buildClaudeArgs` is called with `remoteControl: true` and `name: 'Morgan — my-app'`
- **THEN** the returned args SHALL contain `--remote-control` immediately followed by `Morgan — my-app`

#### Scenario: Enabled by CLI flag overrides config
- **WHEN** `./devshop pair my-app --remote-control` is run with `remoteControl.enabled: false` in config
- **THEN** the pair session SHALL be spawned with `--remote-control`

#### Scenario: Disabled by default
- **WHEN** `buildClaudeArgs` is called without `remoteControl`
- **THEN** the returned args SHALL NOT contain `--remote-control`

### Requirement: Remote Control Applies to Every Interactive Command
The system SHALL apply the Remote Control setting to sessions spawned by `kickoff`, `talk`, `pair`, and `run`, including sessions respawned by the run loop after a usage-limit wait or idle continuation.

#### Scenario: Respawn keeps Remote Control
- **WHEN** a `run` session started with Remote Control is respawned with `--resume` by the auto-resume loop
- **THEN** the respawned session SHALL also be started with `--remote-control`

### Requirement: Remote Control Failure Does Not Block the Session
The system SHALL NOT treat a Remote Control connection failure (for example, an API-key login instead of a claude.ai login) as a session failure; the interactive session continues locally and the run lifecycle is unchanged.

#### Scenario: Not signed in to claude.ai
- **WHEN** a session is spawned with `--remote-control` and Claude Code reports that Remote Control is unavailable
- **THEN** the orchestrator SHALL continue the session and lifecycle exactly as it would without the flag
