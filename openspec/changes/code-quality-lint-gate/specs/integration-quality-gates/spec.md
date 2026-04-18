## MODIFIED Requirements

### Requirement: Phase gate health check
After all groups in a phase complete, the orchestrator SHALL run a full health check gate that includes build validation, test validation, and code quality lint checks. Lint violations are logged as warnings but do not block the phase gate — only build and test failures block.

#### Scenario: Phase gate with lint warnings
- **WHEN** all builds and tests pass but lint violations are detected
- **THEN** the phase gate SHALL pass with lint warnings logged at `warn` level

#### Scenario: Phase gate with build failure and lint warnings
- **WHEN** a build command fails and lint violations are also detected
- **THEN** the phase gate SHALL fail due to the build failure, and lint warnings SHALL also be logged
