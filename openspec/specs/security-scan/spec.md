### Requirement: On-demand security scan command
The CLI SHALL provide a `security` command that runs a standalone Casey security scan against a specified project. The command syntax SHALL be `./devshop security <project-id>`. The command SHALL resolve the project from the registry, invoke Casey via the `security-agent` template with read-only tools (`Read`, `Glob`, `Grep`), and write findings to an internal report file.

#### Scenario: Successful security scan
- **WHEN** the operator runs `./devshop security my-project`
- **THEN** the system resolves `my-project` from the project registry, invokes Casey against the project directory, writes findings to `<project-dir>/openspec/scans/<YYYY-MM-DD>-security.md`, and prints a summary to stdout including cost and findings file path

#### Scenario: Project not found
- **WHEN** the operator runs `./devshop security nonexistent`
- **THEN** the system prints an error message and exits with code 1

#### Scenario: Scan failure
- **WHEN** Casey's agent invocation fails (timeout, budget exceeded, or agent error)
- **THEN** the system prints the failure reason to stderr and exits with code 1

### Requirement: Configurable scan focus
The CLI SHALL accept an optional `--focus <areas>` flag where `<areas>` is a comma-separated list of focus areas. Valid focus areas SHALL include: `secrets`, `deps`, `injection`, `auth`, `config`. When provided, the focus areas SHALL be appended to the user prompt sent to Casey. The system prompt SHALL NOT be modified.

#### Scenario: Focused scan on secrets and dependencies
- **WHEN** the operator runs `./devshop security my-project --focus secrets,deps`
- **THEN** Casey's user prompt includes instructions to focus on hardcoded secrets and insecure dependencies

#### Scenario: No focus flag (full scan)
- **WHEN** the operator runs `./devshop security my-project` without `--focus`
- **THEN** Casey performs a full codebase security audit covering all categories

### Requirement: Budget and timeout overrides
The CLI SHALL accept optional `--budget <usd>` and `--timeout <minutes>` flags to override the default security scan budget ($2) and timeout (5 minutes).

#### Scenario: Custom budget
- **WHEN** the operator runs `./devshop security my-project --budget 5`
- **THEN** Casey's agent invocation uses a $5 budget limit instead of the $2 default

#### Scenario: Custom timeout
- **WHEN** the operator runs `./devshop security my-project --timeout 10`
- **THEN** Casey's agent invocation uses a 10-minute timeout instead of the 5-minute default

### Requirement: Internal findings report
The system SHALL write Casey's scan findings to `<project-dir>/openspec/scans/<YYYY-MM-DD>-security.md`. The `openspec/scans/` directory SHALL be created if it does not exist. If a report for the same date already exists, the system SHALL append a numeric suffix (e.g., `2026-03-18-security-2.md`).

#### Scenario: First scan of the day
- **WHEN** a security scan completes and no report exists for today's date
- **THEN** the findings are written to `openspec/scans/2026-03-18-security.md`

#### Scenario: Multiple scans on the same day
- **WHEN** a security scan completes and `openspec/scans/2026-03-18-security.md` already exists
- **THEN** the findings are written to `openspec/scans/2026-03-18-security-2.md`

### Requirement: Roadmap integration for actionable findings
After writing the scan report, the system SHALL print a summary of findings to stdout. The summary SHALL include the count of issues found by severity (critical, high, medium, low) and the path to the full report. The system SHALL NOT automatically modify the project's roadmap — the operator decides when and how to act on findings.

#### Scenario: Scan with findings
- **WHEN** a security scan completes with actionable findings
- **THEN** stdout displays a summary (e.g., "Found 2 critical, 3 high, 1 medium issues") and the report file path

#### Scenario: Clean scan
- **WHEN** a security scan completes with no findings
- **THEN** stdout displays "No security issues found" and the report file path

### Requirement: SecurityRunner extracts from TechDebtRunner
The security scan logic SHALL be implemented in a standalone `SecurityRunner` class. `TechDebtRunner._runSecurityScan()` SHALL delegate to `SecurityRunner.run()` to eliminate duplication. The `SecurityRunner.run()` return value SHALL match the existing shape: `{ success, output, cost, error }`.

#### Scenario: TechDebtRunner delegates to SecurityRunner
- **WHEN** `TechDebtRunner.run()` executes its security scan phase
- **THEN** it invokes `SecurityRunner.run()` and receives `{ success, output, cost, error }`

#### Scenario: Standalone invocation
- **WHEN** `SecurityRunner.run()` is called directly by the security command
- **THEN** it returns `{ success, output, cost, error }` with Casey's findings in `output`

### Requirement: Recurring scan scheduling
The CLI SHALL accept `--schedule <frequency>` and `--unschedule` flags. `--schedule weekly` SHALL create a launchd plist (macOS) or cron entry that runs `./devshop security <project>` at a randomized time within the week (random day-of-week, random hour between 9-17). `--unschedule` SHALL remove the scheduled entry.

#### Scenario: Install weekly schedule
- **WHEN** the operator runs `./devshop security my-project --schedule weekly`
- **THEN** a launchd plist (macOS) or cron entry is created with a randomized day and hour, and the system prints the scheduled time

#### Scenario: Remove schedule
- **WHEN** the operator runs `./devshop security my-project --unschedule`
- **THEN** the launchd plist or cron entry for this project's security scan is removed

#### Scenario: Schedule already exists
- **WHEN** the operator runs `--schedule` and a security scan schedule already exists for the project
- **THEN** the existing schedule is replaced with a new randomized time
