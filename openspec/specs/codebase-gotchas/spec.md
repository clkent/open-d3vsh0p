# Codebase Gotchas

## Purpose
Replaces the CodebaseScanner's expensive pre-read context injection with a lightweight, human-curated gotchas system. Instead of scanning and injecting up to 8K chars of project files into every prompt, agents receive a small set of known pitfalls and surprising patterns. Agents already have Read, Glob, and Grep tools to explore codebases themselves — gotchas provide high-signal warnings that tools cannot discover.

Supersedes: **Codebase Grounding**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/openspec-reader.js` -- `parseGotchas()` method
- `platform/orchestrator/src/microcycle.js` -- Injects `PROJECT_GOTCHAS` template variable
- `platform/orchestrator/src/parallel-orchestrator.js` -- Loads gotchas, passes to Microcycle
- `templates/agents/_shared/project-gotchas.md` -- Shared partial for gotchas injection
- `templates/agents/implementation-agent/system-prompt.md` -- Include gotchas partial
- `templates/agents/principal-engineer/system-prompt.md` -- Include gotchas partial

## Removed Files
- `platform/orchestrator/src/codebase-scanner.js` -- CodebaseScanner class (254 lines)
- `platform/orchestrator/src/codebase-scanner.test.js` -- Tests (361 lines)
- `templates/agents/_shared/codebase-grounding.md` -- Grounding partial

## Requirements

### Gotchas File Loading
The orchestrator SHALL read `openspec/gotchas.md` from the project directory at session start and inject its content into agent system prompts.

#### Scenario: Gotchas file exists
- **GIVEN** a project with `openspec/gotchas.md` containing pitfall descriptions
- **WHEN** the orchestrator starts a session
- **THEN** all implementation agent and reviewer system prompts SHALL include the gotchas content under a `## Project Gotchas` section

#### Scenario: No gotchas file
- **GIVEN** a project without `openspec/gotchas.md`
- **WHEN** the orchestrator starts a session
- **THEN** system prompts SHALL include "No project gotchas documented yet." in the gotchas section

### CodebaseScanner Removal
The `CodebaseScanner` class and all `codebaseContext` parameters SHALL be removed. Agents explore codebases using their own tools (Read, Glob, Grep).

#### Scenario: Implementation prompt no longer includes scanned files
- **WHEN** the microcycle builds an implementation prompt
- **THEN** `buildImplementationPrompt` SHALL NOT receive or inject codebase context
- **AND** the prompt SHALL still include project directory, requirements, and instructions

#### Scenario: Retry prompt no longer includes scanned files
- **WHEN** the microcycle builds a retry prompt
- **THEN** `buildRetryPrompt` SHALL NOT receive or inject codebase context

### Gotchas Partial
A shared partial `project-gotchas.md` SHALL be included in the implementation agent system prompt and the principal engineer (Morgan) system prompt.

The partial uses the `{{PROJECT_GOTCHAS}}` template variable.
