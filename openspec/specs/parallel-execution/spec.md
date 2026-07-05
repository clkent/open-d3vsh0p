# Parallel Execution

## Purpose
Enables roadmap-driven parallel development by parsing a structured roadmap into phases and groups with dependencies, and by letting Morgan (the Principal Engineer CLI session) delegate independent groups to sub-agents running in isolated git worktrees via the Claude Code Agent tool.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/roadmap/roadmap-reader.js` — roadmap.md parsing, dependency resolution, status tracking, and item marking
- `templates/agents/_shared/sub-agent-delegation.md` — shared rules for Morgan's sub-agent delegation with worktree isolation

## Requirements

### Roadmap Parsing
The system SHALL parse a `roadmap.md` file from `{projectDir}/openspec/roadmap.md` into a structured hierarchy of phases, groups, and items.

The title SHALL be extracted from the pattern `# Roadmap: {title}`.

Phases SHALL be extracted from `## Phase {number}: {label}` headings, where number can be Roman numerals (I, II, III) or Arabic numerals.

Groups SHALL be extracted from `### Group {letter}: {label}` headings under each phase, where letter is a single uppercase character (A, B, C).

Items SHALL be extracted from checkbox lines matching `- [{marker}] \`{id}\` -- {description}`, where marker is ` ` (pending), `x` (complete), or `!` (parked).

#### Scenario: Parse complete roadmap
- **WHEN** `parse()` is called on a valid roadmap.md
- **THEN** the result SHALL be `{ title, phases: [{ number, label, depends, groups: [{ letter, label, items: [{ id, description, status }] }] }] }`

#### Scenario: Item status detection
- **WHEN** an item line contains `- [x]`
- **THEN** its status SHALL be `complete`
- **WHEN** an item line contains `- [!]`
- **THEN** its status SHALL be `parked`
- **WHEN** an item line contains `- [ ]`
- **THEN** its status SHALL be `pending`

#### Scenario: getAllItems flattens the hierarchy
- **WHEN** `getAllItems(roadmap)` is called
- **THEN** the result SHALL be a flat array of all items across all phases and groups, each augmented with `phaseNumber`, `phaseLabel`, `groupLetter`, and `groupLabel`

### Phase Dependencies
The system SHALL resolve phase dependencies from explicit HTML comments and implicit ordering.

Explicit dependencies SHALL be declared via `<!-- depends: Phase {number} -->` comments within a phase section.

Implicit dependencies SHALL be set automatically: each phase after the first SHALL depend on the immediately preceding phase unless an explicit dependency is declared.

#### Scenario: Explicit dependency
- **WHEN** Phase II contains `<!-- depends: Phase I -->` in the roadmap
- **THEN** Phase II's `depends` property SHALL be set to `"I"`

#### Scenario: Implicit dependency
- **WHEN** Phase III has no explicit depends comment and Phase II is the preceding phase with number "II"
- **THEN** Phase III's `depends` property SHALL be set to `"II"`

#### Scenario: First phase has no dependency
- **WHEN** the first phase in the roadmap has no depends comment
- **THEN** its `depends` property SHALL remain null, making it immediately eligible for execution

#### Scenario: Dependency satisfaction check
- **WHEN** `getNextPhase(roadmap, blockingParkedIds)` evaluates a phase whose dependency phase has all items complete or parked (non-blocking)
- **THEN** that phase SHALL be considered ready and returned as the next phase

### Group Concurrency
The system SHALL support two modes of group concurrency within a phase:

1. **Morgan-delegated**: Morgan spawns sub-agents via the Claude Code Agent tool with `isolation: "worktree"` for each independent group. Morgan writes targeted briefs and reviews output before marking items complete.
2. **Direct execution**: Morgan implements group items sequentially when parallelism is unnecessary (single group or simple items).

Morgan SHALL decide which mode to use based on the phase structure and item complexity.

#### Scenario: Morgan delegates multiple groups
- **WHEN** Morgan encounters a phase with Group A and Group B, both with pending items, and determines parallelism is beneficial
- **THEN** Morgan SHALL spawn sub-agents via the Agent tool with worktree isolation, providing each with a scoped implementation brief

#### Scenario: Morgan works sequentially
- **WHEN** Morgan encounters a phase with a single group or determines the items are simple
- **THEN** Morgan SHALL implement the items directly without spawning sub-agents

#### Scenario: Sub-agent output reviewed by Morgan
- **WHEN** a sub-agent completes its delegated work
- **THEN** Morgan SHALL review the changes for consistency with the broader codebase before accepting them

### Git Worktrees for Delegated Groups
When Morgan delegates a group to a sub-agent, worktree isolation SHALL be handled by the Claude Code Agent tool's `isolation: "worktree"` parameter, which gives the sub-agent an isolated copy of the repository.

#### Scenario: Sub-agent worktree via Agent tool
- **WHEN** Morgan spawns a sub-agent with `isolation: "worktree"`
- **THEN** the Agent tool SHALL create a temporary git worktree for the sub-agent, and clean it up when the sub-agent completes

### Roadmap Status Updates
The system SHALL update the roadmap.md file in-place to reflect item completion or parking.

Morgan SHALL edit roadmap.md directly to mark items complete by changing `[ ]` to `[x]` after implementing each item and verifying tests pass.

The `markItemComplete(id)` method SHALL remain available for programmatic use by the run lifecycle wrapper.

The `markItemParked(id)` method SHALL change the checkbox marker from any state to `[!]` for the matching requirement ID.

#### Scenario: Morgan marks item complete directly
- **WHEN** Morgan finishes a roadmap item and tests pass
- **THEN** Morgan SHALL edit roadmap.md to change `- [ ] \`item-id\`` to `- [x] \`item-id\`` and commit the change

#### Scenario: Mark item complete programmatically
- **WHEN** `markItemComplete('user-auth')` is called and the roadmap contains `- [ ] \`user-auth\` -- Description`
- **THEN** the file SHALL be rewritten with `- [x] \`user-auth\` -- Description`

#### Scenario: Mark item parked
- **WHEN** `markItemParked('api-routes')` is called
- **THEN** the checkbox marker for `api-routes` SHALL be changed to `[!]`

#### Scenario: Regex escaping in requirement IDs
- **WHEN** a requirement ID contains regex-special characters (e.g., dots or brackets)
- **THEN** the system SHALL escape them via `_escapeRegex` before constructing the replacement pattern

### Phase Completion Detection
The system SHALL provide a way to detect when all roadmap work is complete.

The `isComplete(roadmap)` method SHALL return true when every item in every group in every phase has status `complete` or `parked`.

#### Scenario: All items complete
- **WHEN** `isComplete(roadmap)` is called and every item across all phases is `complete` or `parked`
- **THEN** the method SHALL return true

#### Scenario: Pending items remain
- **WHEN** at least one item in any phase has status `pending`
- **THEN** `isComplete` SHALL return false
