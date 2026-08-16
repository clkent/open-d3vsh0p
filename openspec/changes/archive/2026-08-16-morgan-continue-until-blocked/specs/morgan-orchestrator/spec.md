# Morgan Orchestrator — Delta

## ADDED Requirements

### Requirement: Continuous Execution
Morgan SHALL work continuously through the roadmap and SHALL end the session only when no remaining pending item can be completed as valuable work: either all items are complete or parked, or every remaining pending item requires an incomplete `[HUMAN]` prerequisite or depends on parked work.

Phase boundaries and Group Z user-testing checkpoints SHALL NOT be stopping points: on reaching one, Morgan SHALL note the checkpoint for the developer and continue into the next phase. Morgan SHALL NOT end a turn with a status summary while unblocked pending items remain.

The interactive initial prompt SHALL tell Morgan that the user may interject at any time but that Morgan must not pause or wait for input. The same continue-until-blocked rule SHALL appear in the run prompt template (which persists across context compaction) and in the shared roadmap execution rules.

#### Scenario: Group Z checkpoint reached mid-run
- **WHEN** Morgan completes a phase's implementation groups and reaches its Group Z user-testing checkpoint while later phases have unblocked pending items
- **THEN** Morgan SHALL note the checkpoint for the developer and continue into the next phase without pausing or ending the turn

#### Scenario: All remaining work is blocked
- **WHEN** every remaining pending item requires an incomplete `[HUMAN]` prerequisite or depends on parked work
- **THEN** Morgan SHALL end the session, summarizing what is blocked and why continuing would not produce valuable work

#### Scenario: Interactive run does not wait for input
- **WHEN** `run` is executed without `--window`
- **THEN** the initial prompt SHALL state that the user can interject but Morgan must not pause to wait for input
