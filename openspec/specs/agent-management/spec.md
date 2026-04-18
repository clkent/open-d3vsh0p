# Agent Management

## Purpose
Invokes Claude agents via the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), manages their lifecycle with timeouts and structured event handling, and builds context-rich prompts from templates and OpenSpec project metadata.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/agents/agent-runner.js` — Claude Agent SDK invocation, timeout handling, and result parsing
- `platform/orchestrator/src/template-engine.js` — template rendering with variable substitution and partial includes
- `platform/orchestrator/src/openspec-reader.js` — project.md parsing, requirement extraction, and prompt building

## Requirements

### Claude Agent SDK Invocation
The system SHALL invoke the Claude Agent SDK's `query()` function to run agents, passing structured options instead of spawning a CLI process.

The system SHALL pass the following SDK options: `prompt` (user prompt), `model` (model name), `cwd` (working directory), `permissionMode: 'bypassPermissions'`, and `allowDangerouslySkipPermissions: true`.

The system SHALL conditionally include `systemPrompt` only on the first turn (when no resumeSessionId is provided).

The system SHALL conditionally include `resume` with the session ID when resuming an existing conversation.

The system SHALL conditionally include `maxBudgetUsd` when a budget is configured.

The system SHALL pass `allowedTools` as a string array when allowedTools is a non-empty array.

The system SHALL pass `disallowedTools` to block all tools when allowedTools is an empty array.

#### Scenario: First invocation with all options
- **WHEN** runAgent is called with systemPrompt, userPrompt, model, maxBudgetUsd, and allowedTools, and no resumeSessionId
- **THEN** the SDK query() SHALL be called with `prompt`, `model`, `cwd`, `permissionMode`, `systemPrompt`, `maxBudgetUsd`, and `allowedTools`

#### Scenario: Resume invocation omits system prompt
- **WHEN** runAgent is called with a resumeSessionId
- **THEN** the SDK options SHALL include `resume` with the session ID and SHALL NOT include `systemPrompt`

#### Scenario: SDK error
- **WHEN** the SDK throws an error during iteration
- **THEN** the system SHALL return `{ success: false, error: "Agent error: {message}", cost: 0 }`

### SDK Event Processing
The system SHALL iterate over the async generator returned by `query()`, processing each message as it arrives.

Each message SHALL be passed to the optional `onEvent` callback if provided.

The system SHALL extract the final result from the `{ type: 'result' }` message, mapping its fields to the return value interface (`success`, `output`, `cost`, `duration`, `sessionId`, `error`).

The system SHALL determine success by checking `resultEvent.subtype === 'success'`.

The system SHALL use the last assistant text as fallback output when the result's `result` field is empty.

#### Scenario: SDK messages processed incrementally
- **WHEN** the agent yields three messages (system, assistant, result)
- **THEN** each message SHALL be passed to `onEvent` as it arrives

#### Scenario: Result extracted from messages
- **WHEN** the agent yields a `{ type: 'result', subtype: 'success', result: 'hello', total_cost_usd: 0.50, session_id: 'abc', duration_ms: 5000 }` message
- **THEN** the system SHALL return `{ success: true, output: 'hello', cost: 0.50, sessionId: 'abc', duration: 5000, error: null }`

#### Scenario: No result event
- **WHEN** the agent completes without yielding a `{ type: 'result' }` message
- **THEN** the system SHALL return `{ success: false, error: 'No result event received from SDK' }`

#### Scenario: onEvent callback receives agent messages
- **WHEN** `onEvent` is provided and the agent yields a message
- **THEN** `onEvent` SHALL be called with the message object

#### Scenario: onEvent not provided
- **WHEN** `onEvent` is not provided (undefined)
- **THEN** the system SHALL still process messages and extract the result normally

### Timeout Handling
The system SHALL enforce a configurable timeout per agent invocation using an AbortController.

The system SHALL pass the AbortController to the SDK via `options.abortController`.

The system SHALL call `abortController.abort()` when the timeout elapses.

#### Scenario: Agent completes within timeout
- **WHEN** the agent completes before the timeout elapses
- **THEN** the system SHALL clear the timeout timer and return the parsed result normally

#### Scenario: Agent exceeds timeout
- **WHEN** the agent does not complete within timeoutMs milliseconds
- **THEN** the system SHALL abort via the AbortController and return `{ success: false, error: "Agent timed out after {timeoutMs}ms" }`

### Template Engine
The system SHALL render agent system prompts from Markdown templates using `{{VAR}}` variable substitution and `{{>partial}}` partial includes.

Templates SHALL be loaded from `{templatesDir}/{agentType}/system-prompt.md`.

Partials SHALL be loaded from `{templatesDir}/_shared/{partialName}.md` with a caching mechanism.

#### Scenario: Variable substitution
- **WHEN** a template contains `{{PROJECT_ID}}` and vars includes `{ PROJECT_ID: "proj-001" }`
- **THEN** all occurrences of `{{PROJECT_ID}}` in the template SHALL be replaced with "proj-001"

#### Scenario: Partial include
- **WHEN** a template contains `{{>testing-standards}}`
- **THEN** the system SHALL load `_shared/testing-standards.md`, cache it, and replace the placeholder with the partial content (trimmed of trailing whitespace)

#### Scenario: Missing partial
- **WHEN** a partial file does not exist at the expected path
- **THEN** the system SHALL leave the `{{>partialName}}` placeholder unchanged in the output

#### Scenario: renderString without file I/O
- **WHEN** `renderString(template, vars)` is called with a string and variables
- **THEN** the system SHALL perform variable substitution inline without loading any files or resolving partials

### Prompt Building
The system SHALL construct structured prompts for implementation, retry, review, and security audit scenarios from OpenSpec project metadata.

The system SHALL parse requirements from the `## Requirements` section of `openspec/project.md`, where each `### Heading` becomes a requirement with an auto-generated kebab-case ID.

#### Scenario: Implementation prompt
- **WHEN** `buildImplementationPrompt(requirement)` is called
- **THEN** the output SHALL contain sections for "Your Assignment", "Requirements" (bullet list), "Project Context" (working directory and source path), and "Instructions" (5-step process)

#### Scenario: Retry prompt with error context
- **WHEN** `buildRetryPrompt(requirement, errorContext)` is called with test failure output
- **THEN** the output SHALL contain a "Previous Attempt Results" section with the error context and a "What To Do" section instructing focused fixes

#### Scenario: Review prompt with diff
- **WHEN** `buildReviewPrompt(requirement, diff, diffStat)` is called
- **THEN** the output SHALL contain the requirement bullets, a "Changes Summary" with diffStat, the "Full Diff" in a code block, and review instructions


