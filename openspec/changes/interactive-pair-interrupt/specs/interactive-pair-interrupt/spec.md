# Interactive Pair Interrupt

## Purpose
Allows users to interrupt a running orchestrator session by pressing `p`, drop into pair mode with Morgan for debugging or guidance, and resume orchestration where it left off without restarting.

## Status
PROPOSED

## Source Files
- `platform/orchestrator/src/parallel-orchestrator.js` — keypress listener, pause-for-pair handling in phase loop, pair spawn and resume
- `platform/orchestrator/src/session/consumption-monitor.js` — `pause_for_pair` reason, `clearPause()` method

## Requirements

### Keypress Detection
The orchestrator SHALL listen for `p` or `P` keypress on stdin during `devshop run` when stdin is a TTY. On detection, the orchestrator SHALL request a pause with reason `pause_for_pair`.

#### Scenario: User presses p during run
- **WHEN** the orchestrator is executing a phase and the user presses `p`
- **THEN** the monitor SHALL receive a pause request with reason `pause_for_pair`
- **AND** the console SHALL display "Pausing for pair mode — finishing current work..."

#### Scenario: Non-TTY stdin
- **WHEN** `devshop run` is executed in a non-TTY environment (CI, piped input)
- **THEN** no keypress listener SHALL be installed
- **AND** the orchestrator SHALL behave identically to current behavior

#### Scenario: Ctrl+C still works
- **WHEN** the user presses Ctrl+C during a run
- **THEN** the existing graceful shutdown behavior SHALL be preserved (first press pauses, second force-exits)

### Graceful Pause at Phase Boundary
When `pause_for_pair` is requested, the orchestrator SHALL finish the current microcycle and pause at the next phase boundary checkpoint. It SHALL NOT interrupt a running agent mid-execution.

#### Scenario: Pause after current phase completes
- **WHEN** `pause_for_pair` is requested while agents are executing a phase
- **THEN** the orchestrator SHALL wait for the current phase execution to complete
- **AND** THEN pause before starting the next phase

#### Scenario: Pause before next item in group
- **WHEN** `pause_for_pair` is requested between items within a group
- **THEN** the orchestrator SHALL pause before starting the next item

### Pair Mode Spawn
On pause, the orchestrator SHALL tear down the stdin listener, spawn Morgan's Claude CLI session with current session context, and wait for the pair session to exit.

#### Scenario: Pair mode launched with context
- **WHEN** the orchestrator pauses for pair
- **THEN** it SHALL spawn a Claude CLI session with context including: current phase label, items completed this session, items parked this session, and active agents at time of pause

#### Scenario: Stdin restored for pair
- **WHEN** pair mode is about to spawn
- **THEN** stdin raw mode SHALL be disabled and the keypress listener SHALL be removed before `spawnClaudeTerminal` is called

### Resume After Pair
When the pair session exits, the orchestrator SHALL resume the phase loop from where it paused without restarting the process.

#### Scenario: Orchestrator resumes after pair exit
- **WHEN** the user exits pair mode (Ctrl+C or /exit)
- **THEN** the orchestrator SHALL reinstall the keypress listener
- **AND** clear the pause state in the monitor
- **AND** re-read the roadmap from disk (to pick up any changes Morgan made)
- **AND** continue the phase loop

#### Scenario: Morgan's changes are picked up
- **WHEN** Morgan makes git commits during the pair session
- **THEN** the orchestrator SHALL re-read the roadmap and detect any status changes on the next loop iteration

### Monitor Pause State Management
The consumption monitor SHALL support a `clearPause()` method that resets the pause state so `shouldStop()` returns `false` after pair mode exits.

#### Scenario: Pause cleared after pair
- **WHEN** `clearPause()` is called after pair mode exits
- **THEN** `shouldStop()` SHALL return `{ stop: false }` on the next check
- **AND** budget/time limit checks SHALL continue to function normally

#### Scenario: Budget exhausted during pair
- **WHEN** the budget was already exhausted before pair mode
- **THEN** `clearPause()` SHALL only clear the `pause_for_pair` reason
- **AND** `shouldStop()` SHALL still return `{ stop: true, reason: 'budget_exhausted' }` after clearing
