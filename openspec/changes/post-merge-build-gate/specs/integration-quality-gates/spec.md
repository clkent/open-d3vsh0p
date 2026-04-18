## MODIFIED Requirements

### Requirement: Post-merge smoke test
After each successful merge to the session branch, the orchestrator SHALL run a smoke test to catch regressions. The smoke test SHALL include all detected health check commands (both test and build commands), using per-command timeouts. Projects MAY opt out of post-merge builds via `healthCheck.postMergeBuild: false`, in which case only test commands run. If any command fails, the orchestrator SHALL attempt a Morgan diagnostic fix before reporting the merge as failed.

#### Scenario: Successful post-merge smoke test
- **WHEN** a merge completes and all detected commands (tests + builds) pass
- **THEN** the merge is confirmed and the orchestrator proceeds to the next requirement

#### Scenario: Failed post-merge smoke test with diagnostic repair
- **WHEN** a post-merge command fails
- **THEN** the orchestrator SHALL run Morgan diagnostic repair, re-run failing commands, and report success or failure

#### Scenario: Post-merge with build opt-out
- **WHEN** a merge completes and `healthCheck.postMergeBuild` is `false`
- **THEN** only test commands SHALL run in the smoke test (build commands are skipped)
