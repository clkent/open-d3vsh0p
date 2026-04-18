# DevShop-Aware PM

## Purpose
Provide a platform-level PM agent runner that gives Riley read-only awareness of DevShop internals (parsers, validators, agent templates) while sandboxing all writes to the assigned project directory. This enables Riley to reason about format requirements from first principles rather than following rules she may misinterpret.

## Status
IMPLEMENTED

## Requirements

### DevShop Context Loading
The PM runner SHALL load key DevShop internal files and inject them into Riley's system prompt as a read-only "System Architecture" section.

#### Scenario: Context files loaded on PM startup
- **WHEN** the PM runner creates a kickoff session
- **THEN** it SHALL read the following DevShop files and inject their contents into the system prompt: `roadmap-reader.js`, `roadmap-validator.js`, `roadmap-format-checker.js` (exported functions only), `implementation-agent/system-prompt.md`, and `principal-engineer-agent/system-prompt.md`

#### Scenario: Context loading failure is non-fatal
- **WHEN** a DevShop context file cannot be read (missing or permission error)
- **THEN** the PM runner SHALL log a warning and continue without that file's context, rather than failing the entire kickoff

#### Scenario: Context is static for the session
- **WHEN** DevShop files change after the PM session has started
- **THEN** the session SHALL continue with the originally loaded context (no live reload)

### Write Sandbox via SDK Hooks
The PM runner SHALL enforce that Riley can only write files within the assigned project directory, using SDK PreToolUse hooks as a deterministic code-level guard.

#### Scenario: Write within project directory succeeds
- **WHEN** Riley calls the Write tool with a file path inside `projectDir` (e.g., `projectDir/openspec/roadmap.md`)
- **THEN** the PreToolUse hook SHALL allow the write to proceed

#### Scenario: Write outside project directory is blocked
- **WHEN** Riley calls the Write tool with a file path outside `projectDir` (e.g., `<devshop-root>/platform/orchestrator/src/microcycle.js`)
- **THEN** the PreToolUse hook SHALL block the write and return a message: "Blocked: writes restricted to {projectDir}"

#### Scenario: Edit outside project directory is blocked
- **WHEN** Riley calls the Edit tool with a file path outside `projectDir`
- **THEN** the PreToolUse hook SHALL block the edit with the same message

#### Scenario: Path traversal is blocked
- **WHEN** Riley calls Write with a path that uses `..` segments to escape `projectDir` (e.g., `projectDir/../../devshop/package.json`)
- **THEN** the PreToolUse hook SHALL resolve the path and block it because the resolved path is outside `projectDir`

#### Scenario: Bash commands run in project directory
- **WHEN** Riley executes a Bash command
- **THEN** the command SHALL execute with `cwd` set to `projectDir` (inherited from AgentRunner)

### PM Runner Interface
The PM runner SHALL provide a session interface compatible with the existing kickoff flow, so `kickoff.js` requires minimal changes.

#### Scenario: Creating a kickoff session
- **WHEN** `kickoff.js` needs a PM session for the Q&A and spec generation phases
- **THEN** it SHALL call `PmRunner.createKickoffSession({ projectDir, projectId, githubRepo, config })` which returns an object with a `.chat(message, options)` method matching the `AgentSession` interface

#### Scenario: Chat method returns standard result
- **WHEN** the PM session's `.chat()` method is called
- **THEN** it SHALL return `{ response, sessionId, cost, success }` matching the existing `AgentSession.chat()` return type

#### Scenario: Tool restrictions follow kickoff phases
- **WHEN** the kickoff is in Q&A phase (before user types "go")
- **THEN** the PM session SHALL restrict tools to `['Read', 'Glob', 'Grep']`
- **AND** the write sandbox hooks SHALL still be active (defense-in-depth)

#### Scenario: Full tools after "go"
- **WHEN** the user types "go" and the kickoff enters spec generation phase
- **THEN** the PM session SHALL allow `['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit']` with the write sandbox hooks still enforcing project-directory-only writes

### DevShop Context Content
The loaded DevShop context SHALL be structured to help Riley understand how her output is consumed.

#### Scenario: Context includes parser code
- **WHEN** Riley's system prompt includes the DevShop context section
- **THEN** it SHALL include the roadmap parser's `parseContent()` method so Riley can see the exact regex patterns used to parse phase headings, group headings, and checkbox items

#### Scenario: Context includes validation rules
- **WHEN** Riley's system prompt includes the DevShop context section
- **THEN** it SHALL include the validator's `validate()` method so Riley can see what constitutes an error (bad IDs, duplicates, empty phases) vs a warning (missing Group Z, missing [HUMAN])

#### Scenario: Context includes implementation agent prompt
- **WHEN** Riley's system prompt includes the DevShop context section
- **THEN** it SHALL include the implementation agent's system prompt so Riley can understand how implementation agents receive and consume her specs
