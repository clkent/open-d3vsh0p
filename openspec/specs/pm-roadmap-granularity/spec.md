# PM Roadmap Granularity

## Purpose
Ensures Riley's roadmap items align 1:1 with specs, preventing over-coarse bundling that blocks parallel execution. Adds explicit rules and a self-audit checklist to the PM agent prompts.

## Status
IMPLEMENTED

## Source Files
- `templates/agents/pm-agent/kickoff-prompt.md` -- spec-roadmap alignment rule, anti-pattern example, self-audit checklist
- `templates/agents/pm-agent/brain-dump-prompt.md` -- spec-roadmap alignment rule (shorter version)

## Requirements

### Spec-Roadmap Alignment Rule
Riley's PM prompts SHALL include a rule stating that every spec file created for a change MUST correspond to at least one roadmap item. If Riley writes N spec files, the roadmap MUST contain at least N items covering those specs. A single roadmap item SHALL NOT bundle work from multiple spec files.

#### Scenario: Multiple specs produce multiple roadmap items
- **WHEN** Riley creates 3 spec files for a single change
- **THEN** the roadmap SHALL contain at least 3 separate items, one per spec capability

#### Scenario: Single spec produces single roadmap item
- **WHEN** Riley creates 1 spec file for a focused capability
- **THEN** the roadmap SHALL contain exactly 1 item for that capability

### Anti-Pattern Example
Riley's PM prompts SHALL include a concrete anti-pattern example showing a bundled roadmap item and the correct split version, demonstrating multiple specs collapsed into one roadmap item vs properly separated items.

#### Scenario: Anti-pattern is shown in kickoff prompt
- **WHEN** Riley reads the "Writing Roadmaps for Agents" section of the kickoff prompt
- **THEN** she SHALL see a labeled anti-pattern ("BAD") showing a single item covering multiple specs
- **AND** a correct version ("GOOD") showing the same work split into separate items matching the spec count

### Pre-Presentation Self-Audit Checklist
Riley's PM prompts SHALL include a numbered self-audit checklist that Riley MUST run before presenting a roadmap. The checklist SHALL verify: (1) every spec has a corresponding roadmap item, (2) no single roadmap item covers multiple specs, (3) no group exceeds 4 items, (4) phase count is 3-5 for MVP.

#### Scenario: Self-audit catches bundled item
- **WHEN** Riley finishes drafting a roadmap where one item covers 3 specs
- **THEN** the self-audit checklist SHALL prompt Riley to split the item before presenting

#### Scenario: Self-audit passes cleanly
- **WHEN** Riley finishes drafting a roadmap where every spec maps to exactly one item and no group exceeds 4 items
- **THEN** the self-audit checklist SHALL pass and Riley SHALL present the roadmap

### Brain-Dump Prompt Alignment Rule
The brain-dump prompt SHALL include a shorter version of the spec-roadmap alignment rule. When adding new specs during a brain-dump session, corresponding roadmap items MUST also be added.

#### Scenario: Mid-project spec addition creates roadmap item
- **WHEN** Riley adds a new spec during a brain-dump session
- **THEN** she SHALL also add a corresponding roadmap item in the appropriate phase and group
