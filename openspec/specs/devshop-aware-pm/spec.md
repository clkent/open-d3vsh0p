# DevShop-Aware PM

## Purpose
Give Riley read-only awareness of DevShop internals (roadmap parser, validator, format checker, review agent prompt) by injecting them into her kickoff prompt. This enables Riley to reason about format requirements from first principles rather than following rules she may misinterpret.

## Status
IMPLEMENTED

## Requirements

### DevShop Context Loading
The system SHALL load key DevShop internal files via `loadDevShopContext()` (`platform/pm/src/devshop-context.js`) and inject them into Riley's kickoff prompt as a read-only context section via the `DEVSHOP_CONTEXT` template variable.

The `CONTEXT_FILES` list SHALL contain four entries, each with a path and an explanatory label: `roadmap-reader.js` (roadmap parser), `roadmap-validator.js` (roadmap validator), `roadmap-format-checker.js` (format checker), and `templates/agents/principal-engineer/system-prompt.md` (review agent prompt).

#### Scenario: Context files loaded on kickoff
- **WHEN** the kickoff command builds Riley's prompt
- **THEN** it SHALL call `loadDevShopContext()` and inject the four labeled file contents into the prompt via `DEVSHOP_CONTEXT`

#### Scenario: Context loading failure is non-fatal
- **WHEN** a DevShop context file cannot be read (missing or permission error)
- **THEN** the loader SHALL emit a warning and continue without that file's context, rather than failing the kickoff

#### Scenario: Context is static for the session
- **WHEN** DevShop files change after the kickoff session has started
- **THEN** the session SHALL continue with the originally loaded context (no live reload)

### DevShop Context Content
The loaded DevShop context SHALL be structured to help Riley understand how her output is consumed. Each file SHALL be rendered as a labeled section (e.g., "Roadmap Parser — this is the exact code that parses your roadmap.md into structured data") followed by the file contents in a fenced code block.

#### Scenario: Context includes parser code
- **WHEN** Riley's kickoff prompt includes the DevShop context section
- **THEN** it SHALL include the roadmap parser source so Riley can see the exact regex patterns used to parse phase headings, group headings, and checkbox items

#### Scenario: Context includes validation rules
- **WHEN** Riley's kickoff prompt includes the DevShop context section
- **THEN** it SHALL include the validator source so Riley can see what constitutes an error (bad IDs, duplicates, empty phases) vs a warning

#### Scenario: Context includes review agent prompt
- **WHEN** Riley's kickoff prompt includes the DevShop context section
- **THEN** it SHALL include the principal engineer's system prompt so Riley can understand what code review checks her specs will be judged against
