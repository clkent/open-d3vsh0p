## Why

During a `devshop run` session, the only way to interact with the project is to Ctrl+C (killing the session), then manually run `devshop pair`. This loses the orchestrator's in-progress state and requires a full `--resume` restart. Users need a way to interrupt a running session, drop into pair mode with Morgan for debugging or guidance, and resume the orchestrator exactly where it left off — without losing work or restarting.

## What Changes

- **Stdin keypress listener during `run`**: Listen for `p` keypress during orchestrator execution. Stdin is currently unused during `devshop run`, so this is safe to add.
- **Pause-for-pair flow**: New pause reason (`pause_for_pair`) in the consumption monitor. At the next safe checkpoint (between items/phases), the orchestrator pauses gracefully, finishes current microcycle work, then spawns pair mode.
- **Inline pair session**: Spawn Morgan's Claude CLI with current session context (active phase, recent completions/failures, active agents). On pair exit, the orchestrator resumes the phase loop without restart — no session teardown or re-initialization.
- **Resume without restart**: Unlike the existing `blocking_park` flow which exits and restarts, this keeps the orchestrator process alive. The phase loop simply continues after pair mode returns.

## Capabilities

### New Capabilities
- `interactive-pair-interrupt`: Keypress-triggered pause during `devshop run` that drops into pair mode with Morgan, then resumes orchestration on exit

### Modified Capabilities
- `cli-interface`: `run` command installs stdin keypress listener, displays hint about `p` to pair

## Impact

- `platform/orchestrator/src/parallel-orchestrator.js` — Install stdin listener on run start, new pause reason handling in phase loop, spawn pair inline, resume after
- `platform/orchestrator/src/session/consumption-monitor.js` — New `pause_for_pair` reason support
- `platform/orchestrator/src/commands/run.js` — Display keypress hint in session header
- `platform/orchestrator/src/commands/pair.js` — Reuse `buildPairContext` and `spawnClaudeTerminal` from the orchestrator context (no changes needed, just imported)
- No new dependencies
