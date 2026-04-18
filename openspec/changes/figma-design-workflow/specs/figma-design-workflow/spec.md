## ADDED Requirements

### Requirement: Design capture session
The system SHALL provide an interactive capture mode via `devshop design <project-id>` that boots the project's dev server, lets the user navigate screens in a browser, and captures each screen to Figma via the Code-to-Canvas MCP tool.

#### Scenario: Start capture session
- **WHEN** the user runs `devshop design proj-001`
- **THEN** the system SHALL start the project's dev server (or detect it already running), connect to the Figma remote MCP server, and enter interactive capture mode

#### Scenario: Capture a screen
- **WHEN** the user presses `c` in capture mode
- **THEN** the system SHALL prompt for a screen name, invoke Code-to-Canvas to capture the current browser viewport, and push it to the Figma file as a new page named after the screen

#### Scenario: List captured screens
- **WHEN** the user presses `l` in capture mode
- **THEN** the system SHALL display all screens captured in the current session with their names

#### Scenario: Finish capture session
- **WHEN** the user presses `d` (done) in capture mode
- **THEN** the system SHALL save a design snapshot, display the Figma file URL, and print instructions for running `--reconcile` when design work is complete

#### Scenario: Quit without handoff
- **WHEN** the user presses `q` in capture mode
- **THEN** the system SHALL exit without saving a snapshot or displaying reconciliation instructions

#### Scenario: Capture failure
- **WHEN** Code-to-Canvas fails for a screen capture
- **THEN** the system SHALL display the error, allow the user to retry, and NOT exit capture mode

### Requirement: Design snapshot persistence
The system SHALL save a snapshot of the design context at capture time to enable diffing during reconciliation.

#### Scenario: Snapshot saved on capture completion
- **WHEN** the user completes a capture session (presses `d`)
- **THEN** the system SHALL save a JSON snapshot to `active-agents/<project-id>/orchestrator/design-snapshots/<timestamp>.json` containing the Figma file URL, screen names, and the design context for each captured screen

#### Scenario: Multiple capture sessions
- **WHEN** the user runs `devshop design` multiple times
- **THEN** each session SHALL create a new timestamped snapshot, and reconciliation SHALL diff against the most recent snapshot

### Requirement: Design reconciliation
The system SHALL provide a `devshop design <project-id> --reconcile` command that reads the current Figma design context, diffs against the saved snapshot, and produces specs and roadmap items for the detected changes.

#### Scenario: Reconcile with changes detected
- **WHEN** the user runs `devshop design proj-001 --reconcile` and the designer has modified screens in Figma
- **THEN** the system SHALL read design context from Figma via `get_design_context`, compare against the most recent snapshot, display a summary of detected changes per screen, and invoke Riley to create implementation specs and roadmap items

#### Scenario: Reconcile with no changes
- **WHEN** the user runs `--reconcile` and the Figma file is unchanged from the snapshot
- **THEN** the system SHALL report "No design changes detected" and exit without creating specs

#### Scenario: Reconcile updates design tokens
- **WHEN** reconciliation detects changes to colors, spacing, typography, or border radii
- **THEN** the system SHALL update `openspec/design-tokens.json` with the new values and update design guidance in `openspec/project.md`

#### Scenario: Reconcile updates design guidance
- **WHEN** reconciliation produces new specs
- **THEN** the system SHALL update the design approach section in `openspec/project.md` to reflect the designer's direction, so future implementation agents follow the updated design

#### Scenario: No snapshot exists
- **WHEN** the user runs `--reconcile` but no capture snapshot exists for the project
- **THEN** the system SHALL display an error instructing the user to run `devshop design <project-id>` first

### Requirement: Figma MCP client
The system SHALL communicate with Figma via the remote MCP server for both push (Code-to-Canvas) and read (design context) operations.

#### Scenario: Code-to-Canvas push
- **WHEN** a capture is triggered
- **THEN** the system SHALL invoke the `generate_figma_design` tool on the Figma remote MCP server to capture the current browser viewport and create editable Figma layers

#### Scenario: Design context read
- **WHEN** reconciliation is triggered
- **THEN** the system SHALL invoke `get_design_context` on the Figma MCP server for each screen in the snapshot, using the Figma file URL and page/frame identifiers

#### Scenario: MCP connection failure
- **WHEN** the Figma MCP server is unreachable
- **THEN** the system SHALL display a clear error message with troubleshooting steps (check Figma account, MCP server URL, network) and exit with a non-zero code

### Requirement: Async non-blocking design
The design command SHALL operate independently of the orchestrator. Running `devshop design` SHALL NOT block or interfere with `devshop run`.

#### Scenario: Design during active session
- **WHEN** `devshop run` is actively implementing requirements and the user runs `devshop design` in a separate terminal
- **THEN** both commands SHALL operate independently without interference

#### Scenario: Reconciled changes feed into next run
- **WHEN** reconciliation creates new roadmap items
- **THEN** the next `devshop run` session SHALL pick up the new requirements automatically
