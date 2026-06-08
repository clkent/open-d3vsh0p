# Change: Riley CLI Session

## Summary

Replace the in-process Agent SDK message loop in `kickoff` and `talk` commands with spawning Claude Code CLI, matching the pattern already used by the `pair` command. Extract shared CLI spawn utilities to avoid duplication.

## Changes

### New Files
- `platform/orchestrator/src/commands/cli-spawn.js` — shared CLI spawn utilities (buildClaudeArgs, spawnClaudeTerminal, saveCliSession, loadCliSession)

### Modified Files
- `platform/orchestrator/src/commands/talk.js` — rewritten to use CLI spawn instead of AgentSession
- `platform/orchestrator/src/commands/kickoff.js` — rewritten to use CLI spawn instead of PmRunner
- `platform/orchestrator/src/commands/pair.js` — refactored to import from cli-spawn.js

### Removed Dependencies (from kickoff/talk)
- `AgentRunner` — no longer needed for interactive sessions
- `AgentSession` — replaced by Claude CLI native session management
- `PmRunner` / `PmSession` — replaced by CLI spawn with rendered prompt
- `BroadcastServer` — CLI sessions don't emit SDK events
- `readMultiLineInput` — Claude CLI handles its own input

## Status
Implemented
