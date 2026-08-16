# Limit-Aware Resume — Delta

## MODIFIED Requirements

### Requirement: Availability Probe
The system SHALL provide an availability probe that runs a minimal headless `claude -p` call with piped stdio and a bounded timeout (~60 seconds), and classifies the result as one of: `available` (exit code 0), `limited` (non-zero exit with combined stdout+stderr matching a case-insensitive usage-limit pattern covering at least `hit your … limit`, `reached your … limit`, `usage limit`, `limit reached`, and `resets`), or `unknown` (any other failure, including timeout and network errors).

The probe SHALL run with the same model Morgan's session is configured to use, passing `--model` only when Morgan's config specifies one (so an unconfigured probe uses the account default, matching Morgan). The probe SHALL capture both stdout and stderr for classification and SHALL NOT echo either stream to the orchestrator's output.

The probe SHALL NOT attempt to parse a reset timestamp from CLI output.

#### Scenario: Probe classifies available
- **WHEN** the probe subprocess exits with code 0
- **THEN** the probe SHALL return `available`

#### Scenario: Probe classifies limited from either stream
- **WHEN** the probe subprocess exits non-zero and the limit pattern appears on stdout or stderr
- **THEN** the probe SHALL return `limited`

#### Scenario: Probe mirrors Morgan's model
- **WHEN** Morgan's session is configured with a specific model
- **THEN** the probe SHALL pass that model via `--model`, and SHALL omit `--model` when Morgan has no configured model

#### Scenario: Probe classifies unknown
- **WHEN** the probe subprocess exits non-zero without a matching pattern on either stream, or times out
- **THEN** the probe SHALL return `unknown`, and the caller SHALL NOT treat this as confirmation of either availability or limitation

### Requirement: Frozen-Session Stall Detection
While Morgan's CLI session is running, the system SHALL watch the project's transcript directory (`~/.claude/projects/<sanitized-projectDir>/`, where non-alphanumeric characters in the project path are replaced with `-`) by polling approximately once per minute for the maximum mtime across `*.jsonl` files. Tracking the directory's newest transcript (rather than one fixed session file) keeps detection working after `--resume` creates a new session transcript. The system SHALL only stat file mtimes and SHALL NOT parse transcript contents.

When the newest mtime has not advanced for the stall threshold (default 10 minutes), the system SHALL run the availability probe. If the probe returns `limited`, the system SHALL terminate Morgan's process (SIGTERM, escalating to SIGKILL after a grace period) and enter the limit wait loop. If the probe returns `available` or `unknown`, the system SHALL keep watching and SHALL re-probe on a re-probe interval (default 15 minutes) for as long as the stall persists; fresh transcript activity resets the stall cycle. A non-`limited` probe SHALL NOT permanently disable detection.

If no transcript files can be found after session start (three consecutive failed checks), the system SHALL disable stall detection for the run, log a warning, and rely on early-exit detection only.

#### Scenario: Stall confirmed as limit
- **WHEN** the newest transcript mtime has not advanced for the stall threshold and the probe returns `limited`
- **THEN** the system SHALL terminate Morgan's process and enter the limit wait loop

#### Scenario: Misclassified probe self-heals
- **WHEN** a stall probe returns `available` or `unknown` and the transcript remains stalled
- **THEN** the system SHALL re-probe after the re-probe interval, and SHALL detect the limit on a later probe that returns `limited`

#### Scenario: Detection survives resume
- **WHEN** Morgan is respawned with `--resume` and Claude Code writes a new transcript file in the project's transcript directory
- **THEN** the watcher SHALL track the new file's activity via the directory's newest mtime without reconfiguration

#### Scenario: Transcript directory missing
- **WHEN** no transcript files exist after Morgan's session starts (three consecutive checks)
- **THEN** the system SHALL log a warning, disable stall detection for the run, and keep only early-exit detection active
