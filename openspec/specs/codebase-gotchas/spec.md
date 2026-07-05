# Codebase Gotchas

## Purpose
Provides a lightweight, human-curated gotchas system instead of expensive pre-read context injection. Known pitfalls and surprising patterns live in `openspec/gotchas.md`; agents discover them via the project's generated CLAUDE.md and explore the codebase themselves with Read, Glob, and Grep. Gotchas provide high-signal warnings that tools cannot discover.

Supersedes: **Codebase Grounding**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/roadmap/openspec-reader.js` -- `parseGotchas()` method
- `platform/orchestrator/src/commands/kickoff.js` -- references `openspec/gotchas.md` in the generated project CLAUDE.md
- `templates/project-starter/CLAUDE.md` -- starter CLAUDE.md pointing agents at `openspec/gotchas.md`

## Requirements

### Gotchas File Reader
The OpenSpec reader SHALL provide a `parseGotchas()` method that reads `openspec/gotchas.md` from the project directory.

#### Scenario: Gotchas file exists
- **WHEN** `parseGotchas()` is called and `openspec/gotchas.md` exists
- **THEN** it SHALL return the file contents

#### Scenario: No gotchas file
- **WHEN** `parseGotchas()` is called and `openspec/gotchas.md` does not exist
- **THEN** it SHALL return `null` without throwing

### Gotchas Reference in Generated CLAUDE.md
The kickoff command SHALL surface gotchas to agents via the project's CLAUDE.md. When `openspec/gotchas.md` exists at CLAUDE.md generation time, the generated file SHALL include a `## Gotchas` section directing agents to read `openspec/gotchas.md` for known pitfalls and surprising patterns.

#### Scenario: Project with gotchas file
- **GIVEN** a project with `openspec/gotchas.md` containing pitfall descriptions
- **WHEN** kickoff generates the project's CLAUDE.md
- **THEN** the CLAUDE.md SHALL contain a Gotchas section pointing at `openspec/gotchas.md`

#### Scenario: Project without gotchas file
- **GIVEN** a project without `openspec/gotchas.md`
- **WHEN** kickoff generates the project's CLAUDE.md
- **THEN** the Gotchas section SHALL be omitted

### No Pre-Scanned Context Injection
The system SHALL NOT scan and inject project file contents into agent prompts. Agents explore codebases using their own tools (Read, Glob, Grep); the former `CodebaseScanner` and its `codebaseContext` injection remain removed.

#### Scenario: Agents explore instead of receiving scans
- **WHEN** any agent session is created for a project
- **THEN** its prompt SHALL NOT include bulk pre-read file contents; agents read the codebase (including `openspec/gotchas.md`) with their own tools
