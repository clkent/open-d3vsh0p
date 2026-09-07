## ADDED Requirements

### Requirement: Reader-Level Group Z Exception
The roadmap reader's actionable-phase computation SHALL apply the same Group Z exception Morgan follows: pending items in a dependency phase's Group Z SHALL NOT prevent the dependent phase from being actionable, while pending non-Group-Z `[HUMAN]` items SHALL. The `run` command's idle-continuation gate and the `action` command SHALL therefore agree with Morgan about which phases are open.

#### Scenario: Idle continuation sees the next phase's work
- **WHEN** Morgan goes idle, Phase I's only pending item is its Group Z checkpoint, and Phase II (depending on Phase I) has a pending non-HUMAN item
- **THEN** the unblocked pending set SHALL include the Phase II item and the run SHALL continue Morgan

#### Scenario: Action lists HUMAN items behind a checkpoint
- **WHEN** Phase I's only pending item is its Group Z checkpoint and Phase II (depending on Phase I) has a pending `[HUMAN]` item in Group A
- **THEN** `devshop action` SHALL list the Phase II item as actionable
