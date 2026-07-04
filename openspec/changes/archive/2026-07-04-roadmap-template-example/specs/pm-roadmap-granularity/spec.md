# PM Roadmap Granularity — Delta Spec (roadmap-template-example)

## New Requirements

### Roadmap Template Example
Riley's PM prompts SHALL include a complete roadmap template demonstrating proper end-to-end structure including: Roman numeral phases, `<!-- depends: -->` comments, spike phase with `[SPIKE]` item, implementation phases with parallel groups, `[HUMAN]` items in dedicated groups, Group Z user testing checkpoints with specific descriptions, kebab-case IDs, em-dash separators, and 3-5 items per group.

#### Scenario: Template included in rendered prompt
- **WHEN** the orchestrator renders kickoff-prompt.md, brain-dump-prompt.md, or system-prompt.md
- **THEN** the rendered output SHALL contain the complete roadmap template example after the roadmap rules section

#### Scenario: Template validates cleanly
- **WHEN** the roadmap template content is passed through `findNearMisses()`, `findHeadingLevelIssues()`, `findMissingGroups()`, and `findTimelineEstimates()`
- **THEN** all functions SHALL return empty arrays (zero validation errors)
