## MODIFIED Requirements

### Requirement: Phase Dependencies
The system SHALL resolve phase dependencies from explicit HTML comments and implicit ordering.

Explicit dependencies SHALL be declared via `<!-- depends: Phase {number} -->` comments within a phase section. The system SHALL extract every `Phase {number}` reference in the comment and ignore any other text (for example a note such as `; blocked on a vendor account`). A comment containing no phase references SHALL yield an empty dependency list.

Implicit dependencies SHALL be set automatically: each phase after the first SHALL depend on the immediately preceding phase unless an explicit dependency comment is present.

A phase SHALL be actionable only when every dependency resolves to a phase in the roadmap whose items are all complete or parked. A dependency that does not resolve to any phase SHALL block the phase.

#### Scenario: Explicit dependency
- **WHEN** Phase II contains `<!-- depends: Phase I -->` in the roadmap
- **THEN** Phase II's `depends` property SHALL be `["I"]`

#### Scenario: Dependency with a trailing note
- **WHEN** Phase III contains `<!-- depends: Phase II; blocked on a vendor account -->`
- **THEN** Phase III's `depends` property SHALL be `["II"]`

#### Scenario: Multiple references with text between them
- **WHEN** a phase contains `<!-- depends: Phase IV and Phase V -->`
- **THEN** its `depends` property SHALL be `["IV", "V"]`

#### Scenario: Comment without references
- **WHEN** a phase contains `<!-- depends: none -->`
- **THEN** its `depends` property SHALL be `[]` and the phase SHALL be actionable

#### Scenario: Implicit dependency
- **WHEN** Phase III has no explicit depends comment and Phase II is the preceding phase with number "II"
- **THEN** Phase III's `depends` property SHALL be `["II"]`

#### Scenario: First phase has no dependency
- **WHEN** the first phase in the roadmap has no depends comment
- **THEN** its `depends` property SHALL remain null, making it immediately eligible for execution

#### Scenario: Unknown dependency blocks
- **WHEN** Phase II contains `<!-- depends: Phase IX -->` and no Phase IX exists
- **THEN** `getActionablePhaseNumbers` SHALL NOT include Phase II

#### Scenario: Dependency enforcement by Morgan
- **WHEN** Morgan works the roadmap and a phase's dependency phase still has pending items
- **THEN** Morgan SHALL NOT start that phase, per the roadmap execution rules in his orchestration prompt
