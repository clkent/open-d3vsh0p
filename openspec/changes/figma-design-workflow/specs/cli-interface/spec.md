## ADDED Requirements

### Requirement: Design command
The CLI SHALL support a `design` command for managing the Figma design workflow.

#### Scenario: Design capture mode
- **WHEN** `devshop design <project-id>` is executed
- **THEN** the system SHALL resolve the project, start the dev server if needed, connect to the Figma MCP server, and enter interactive capture mode

#### Scenario: Design reconcile mode
- **WHEN** `devshop design <project-id> --reconcile` is executed
- **THEN** the system SHALL read the current Figma design context, diff against the most recent snapshot, display changes, and invoke Riley to create specs and roadmap items

#### Scenario: Unknown project
- **WHEN** `devshop design nonexistent-project` is executed
- **THEN** the system SHALL print an error message and exit with code 1

#### Scenario: Help text includes design command
- **WHEN** `devshop help` is executed
- **THEN** the usage output SHALL list the `design` command with a description of its purpose
