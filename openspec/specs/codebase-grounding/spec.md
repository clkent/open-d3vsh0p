# Codebase Grounding

## Purpose
Prevents agents from pattern-matching plausible code from training data instead of reading the actual codebase. Before writing any code, agents must demonstrate they understand the existing project structure by reading key files. The orchestrator pre-reads critical files and injects their content into the implementation prompt so agents literally cannot avoid seeing existing code.

Addresses: **Pattern Matching Over Coding (#7)**, **Ignoring Files (#10)**, **Hallucinations (#2)**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/codebase-scanner.js` -- CodebaseScanner class that reads key project files
- `platform/orchestrator/src/microcycle.js` -- Updated to call scanner before implementation
- `platform/orchestrator/src/openspec-reader.js` -- Updated buildImplementationPrompt to include scanned context
- `templates/agents/_shared/codebase-grounding.md` -- Shared partial reinforcing "read before write"

## Requirements

### Pre-Implementation File Scanning
The orchestrator SHALL scan the project's key files before each implementation invocation and inject their content into the agent's prompt. This ensures the agent sees real code, not imagined code.

#### Scenario: Scan discovers package.json, entry point, and existing test file
- **GIVEN** a project at `PROJECT_DIR` with `package.json`, `src/index.ts`, and `src/__tests__/app.test.ts`
- **WHEN** the CodebaseScanner runs before implementation of requirement "user-auth"
- **THEN** the implementation prompt SHALL include truncated content from all three files under a `## Existing Code Context` section

#### Scenario: Scan targets files relevant to the requirement
- **GIVEN** a requirement named "User Authentication" with bullets mentioning "middleware" and "JWT"
- **WHEN** the scanner runs
- **THEN** it SHALL prioritize files matching keywords from the requirement (e.g., files containing "auth", "middleware", "jwt") alongside the standard key files

#### Scenario: Large files are truncated
- **GIVEN** a source file longer than 200 lines
- **WHEN** the scanner includes it in the prompt
- **THEN** it SHALL include the first 100 lines and last 50 lines with a `... (truncated) ...` marker, plus a line count

### Key File Discovery
The scanner SHALL auto-discover key project files using a priority list:

1. `package.json` (or equivalent manifest) -- always included
2. Project entry point (`src/index.ts`, `src/index.js`, `src/app.ts`, `src/main.ts`) -- first match
3. Existing test files in the same domain as the requirement -- up to 2 files
4. Files matching requirement keywords in `src/` -- up to 3 files
5. Config files relevant to the tech stack (`tsconfig.json`, `jest.config.*`, `vite.config.*`) -- up to 2 files

#### Scenario: No matching files found
- **GIVEN** a brand-new project with only `package.json` and no `src/` directory
- **WHEN** the scanner runs
- **THEN** it SHALL include only `package.json` and note "No existing source files found -- this appears to be a greenfield implementation"

#### Scenario: Maximum context budget
- **WHEN** the total scanned content exceeds 8000 characters
- **THEN** the scanner SHALL prioritize files by the priority list above and drop lowest-priority files until within budget

### Prompt Integration
The scanned context SHALL be injected into the implementation prompt between the requirements section and the instructions section, under a heading `## Existing Code Context`.

#### Scenario: Retry prompts also include scanned context
- **WHEN** a retry prompt is built after test failure or review feedback
- **THEN** the scanned context SHALL be included again (files may have changed since last attempt)

### Grounding Partial
A new shared partial `codebase-grounding.md` SHALL be added to all implementation agent system prompts reinforcing the read-first discipline:

```
## Codebase Grounding

You MUST base your implementation on the actual code shown in "Existing Code Context" above. Do not:
- Invent imports for modules that don't exist in the project
- Assume API signatures without checking the actual source
- Use patterns from your training data that conflict with the project's established patterns

If the existing code context doesn't include a file you need to understand, READ IT before writing code that depends on it.
```
