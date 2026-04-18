# Design-Aware Agents

## Purpose
Conditionally inject design workflow instructions into implementation and review agents when Impeccable design skills are present in the project. Ensures frontend code gets polished for visual quality and reviewed against design criteria without impacting non-frontend projects.

## Status
IMPLEMENTED

## Requirements

### Design Skills Detection
The system SHALL detect the presence of impeccable design skills by checking for the `.claude/skills/frontend-design` directory in the project. The detection result SHALL be available as a `HAS_DESIGN_SKILLS` template variable for agent prompt rendering.

#### Scenario: Design skills present
- **WHEN** the project directory contains `.claude/skills/frontend-design/`
- **THEN** `HAS_DESIGN_SKILLS` SHALL be set to `true` in template variables

#### Scenario: Design skills absent
- **WHEN** the project directory does not contain `.claude/skills/frontend-design/`
- **THEN** `HAS_DESIGN_SKILLS` SHALL be set to an empty string

### Design Skills Shared Partial
The system SHALL provide a shared partial at `templates/agents/_shared/design-skills.md` that renders design-specific instructions when `HAS_DESIGN_SKILLS` is truthy and renders to empty content when falsy.

#### Scenario: Partial renders design guidance when skills present
- **WHEN** `{{>design-skills}}` is included in an agent prompt and `HAS_DESIGN_SKILLS` is truthy
- **THEN** the rendered output SHALL include instructions to run `/polish` on new UI component files and `/audit` before final commit

#### Scenario: Partial renders nothing when skills absent
- **WHEN** `{{>design-skills}}` is included in an agent prompt and `HAS_DESIGN_SKILLS` is empty
- **THEN** the rendered output SHALL be empty (no design instructions injected)

### Implementation Agent Design Workflow
The implementation agent prompt SHALL include `{{>design-skills}}` so that when design skills are present, the agent receives instructions to run `/polish` on new or modified `.tsx`, `.vue`, `.svelte`, `.jsx` files and `/audit` before its final commit.

#### Scenario: Agent runs polish on frontend files
- **WHEN** design skills are present and the implementation agent creates or modifies a `.tsx` file
- **THEN** the agent's system prompt SHALL instruct it to run `/polish` on the file before committing

#### Scenario: Agent runs audit before final commit
- **WHEN** design skills are present and the implementation agent is about to make its final commit
- **THEN** the agent's system prompt SHALL instruct it to run `/audit` to check design consistency

### Review Agent Design Scoring
Morgan's review prompt SHALL include a `design_quality` scoring dimension when `HAS_DESIGN_SKILLS` is truthy. The dimension SHALL assess: consistent spacing system, readable typography, accessible color contrast (WCAG AA), responsive layout patterns, and absence of hardcoded magic pixel values.

#### Scenario: Design quality scored in review
- **WHEN** Morgan reviews a diff containing frontend files and design skills are present
- **THEN** the review prompt SHALL include `design_quality` as a scoring dimension with criteria for spacing, typography, contrast, and responsiveness

#### Scenario: Design quality omitted for non-frontend projects
- **WHEN** Morgan reviews a diff and design skills are not present
- **THEN** the review prompt SHALL NOT include the `design_quality` dimension
