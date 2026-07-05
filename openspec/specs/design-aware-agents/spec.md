# Design-Aware Agents

## Purpose
Installs Impeccable design skills into frontend projects at kickoff and makes agents aware of them, ensuring UI code gets polished for visual quality without impacting non-frontend projects.

## Status
IMPLEMENTED

## Requirements

### Design Skills Installation at Kickoff
The `kickoff` command SHALL accept a `--design` flag. When provided, the project scaffolder SHALL install the Impeccable design skills into the new project's `.claude/skills/` directory. Installation failure SHALL be a logged warning, not a fatal error.

#### Scenario: Kickoff with design flag
- **WHEN** `./devshop kickoff my-app --design` is executed
- **THEN** the scaffolder SHALL install the design skills and print a confirmation that they were installed to `.claude/skills/`

#### Scenario: Design skills install failure is non-fatal
- **WHEN** the design skills cannot be installed (e.g., source missing)
- **THEN** the scaffolder SHALL log a `design_skills_failed` warning and continue the kickoff

### Design Skills Detection
The system SHALL detect the presence of Impeccable design skills by checking for the `.claude/skills/frontend-design` directory in the project (`OpenSpecReader.hasDesignSkills()`).

#### Scenario: Design skills present
- **WHEN** the project directory contains `.claude/skills/frontend-design/`
- **THEN** `hasDesignSkills()` SHALL return `true` and `getDesignSkillsSection()` SHALL return the design workflow instructions

#### Scenario: Design skills absent
- **WHEN** the project directory does not contain `.claude/skills/frontend-design/`
- **THEN** `hasDesignSkills()` SHALL return `false` and `getDesignSkillsSection()` SHALL return an empty string

### Design Awareness in Generated CLAUDE.md
When design skills are detected at CLAUDE.md generation time, the kickoff command SHALL add a Design section to the project's CLAUDE.md instructing agents to use the Impeccable design commands (e.g., `/impeccable polish`, `/impeccable audit`) when working on UI code. For frontend-looking projects without design skills, kickoff SHALL print a tip suggesting re-running with `--design`.

#### Scenario: CLAUDE.md design section
- **WHEN** kickoff generates CLAUDE.md and `.claude/skills/frontend-design` exists
- **THEN** the generated CLAUDE.md SHALL instruct agents to use the Impeccable design commands for UI work

#### Scenario: Frontend project without design skills
- **WHEN** kickoff generates CLAUDE.md, design skills are absent, and the project looks like a frontend project
- **THEN** kickoff SHALL print a tip suggesting `--design`

### Design Skills Shared Partial
The system SHALL provide a shared partial at `templates/agents/_shared/design-skills.md` that renders the `{{DESIGN_SKILLS_SECTION}}` variable, so agent prompts that include `{{>design-skills}}` receive design instructions when the section is supplied and nothing when it is empty.

#### Scenario: Partial renders design guidance when section supplied
- **WHEN** `{{>design-skills}}` is included in an agent prompt and `DESIGN_SKILLS_SECTION` is rendered with design instructions
- **THEN** the rendered output SHALL include those design workflow instructions

#### Scenario: Partial renders nothing when section empty
- **WHEN** `{{>design-skills}}` is included in an agent prompt and `DESIGN_SKILLS_SECTION` is an empty string
- **THEN** the rendered output SHALL be empty (no design instructions injected)
