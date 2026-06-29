# Riley CLI Session

## Overview

Replace Riley's in-process Agent SDK chat loop with spawning Claude Code CLI (like Morgan's pair mode), enabling native tool use, streaming output, and a consistent interactive experience across kickoff and talk commands.

## Motivation

The current kickoff and talk commands use `AgentRunner` + `AgentSession` to run Riley via the Claude Agent SDK. This means:
- No streaming output — user sees "Riley is thinking..." then gets a wall of text
- Restricted tool access — Riley can only use tools explicitly allowed via `allowedTools`
- Manual readline loop — DevShop reimplements what Claude Code CLI already provides
- Inconsistent UX — pair command already uses CLI spawn, but kickoff/talk use SDK

By spawning Claude Code CLI directly (like pair.js does for Morgan), Riley gets:
- Real-time streaming output
- Native Claude Code tool use (Read, Write, Edit, Bash, etc.)
- Slash commands, keyboard shortcuts, and all CLI features
- Session resume via `--resume`

## Scope

### In Scope
- **kickoff command**: Replace PmRunner/AgentSession with CLI spawn for the interactive Q&A and spec generation phases
- **talk command**: Replace AgentSession with CLI spawn for the interactive conversation
- **Shared CLI spawn utility**: Extract `buildClaudeArgs`, `spawnClaudeTerminal`, `saveCliSession`, `loadCliSession` from pair.js into reusable module
- **pair.js refactor**: Update pair command to use the shared utility instead of its own copies
- **Post-session validation**: File and format validation after CLI exits, with re-enter option (like pair's health check pattern)

### Out of Scope
- plan command migration (can follow same pattern later)
- Broadcast/watch integration during CLI sessions (CLI doesn't emit SDK events)
- Bootstrap agent (remains SDK-based — it's non-interactive)

## Behavior

### Talk Command
1. Gather project context (orchestrator state, roadmap progress) — unchanged
2. Render Riley's system prompt template with context
3. Spawn `claude --dangerously-skip-permissions --append-system-prompt <prompt>` in the project directory
4. User interacts directly with Riley via Claude Code CLI
5. On exit: run format validators (roadmap + requirements)
6. If validation fails: offer `[r]e-enter / [p]ush anyway / [q]uit`
7. Offer to push changes to GitHub

### Kickoff Command
1. Scaffold project — unchanged
2. Load DevShop context and render kickoff prompt template
3. Spawn Claude CLI with the rendered prompt
4. Riley handles the entire Q&A → spec generation flow inside the CLI session
5. On exit: validate kickoff output (missing files, format checks)
6. If validation fails: offer `[r]e-enter / [s]kip / [q]uit`
7. Generate enriched CLAUDE.md — unchanged
8. Run bootstrap agent (SDK-based) — unchanged
9. Offer to push changes

### Session Resume
- Each command saves its Claude session ID to `<type>-session.json`
- `--resume` flag loads the saved session and passes `--resume <id>` to Claude CLI

### Tool Access
- In CLI mode, Riley has full access to Claude Code's native tools
- The kickoff prompt instructs Riley not to create files during Q&A phase (prompt discipline replaces tool restrictions)
- The "go" trigger works naturally — Riley reads it as user input in the CLI session

## Dependencies
- Phase XI (Session Resilience) — context-refresh, session-exit-push — complete
