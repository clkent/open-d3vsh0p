# Agent Templates

## Purpose
Provides persona-based system prompts and configuration for all agent roles in the DevShop orchestrator. Each agent type has a dedicated directory containing a system-prompt.md and config.json. Shared behavioral standards are factored into reusable partials. Variable substitution injects project-specific context at render time.

## Status
IMPLEMENTED

## Source Files
- `templates/agents/implementation-agent/system-prompt.md` -- Implementation agent prompt
- `templates/agents/implementation-agent/config.json` -- Implementation agent config
- `templates/agents/principal-engineer/system-prompt.md` -- Morgan persona prompt
- `templates/agents/security-agent/system-prompt.md` -- Casey persona prompt
- `templates/agents/pm-agent/system-prompt.md` -- Riley standard PM prompt
- `templates/agents/pm-agent/brain-dump-prompt.md` -- Riley brain dump session prompt
- `templates/agents/*/config.json` -- per-agent role configuration
- `templates/agents/_shared/testing-standards.md` -- shared testing standards partial
- `platform/orchestrator/src/template-engine.js` -- TemplateEngine with partial resolution and variable substitution

## Requirements

### Template Directory Structure
The system SHALL organize agent templates such that each agent type has its own directory under `templates/agents/` containing a `system-prompt.md` file and a `config.json` file. The directory name SHALL match the `agentType` identifier used by the orchestrator.

#### Scenario: Implementation agent directory
- **WHEN** the template engine renders agent type `implementation-agent`
- **THEN** it SHALL read from `templates/agents/implementation-agent/system-prompt.md`

#### Scenario: Config file per agent
- **WHEN** `getAgentConfig('implementation-agent')` is called
- **THEN** it SHALL return parsed JSON from `templates/agents/implementation-agent/config.json` containing `role`, `name`, `model`, `temperature`, and `permissions`

#### Scenario: Missing config file handled gracefully
- **WHEN** `getAgentConfig` is called for an agent type with no config.json
- **THEN** it SHALL return an empty object `{}` without throwing

### Implementation Agent
The system SHALL provide a single implementation agent template with a neutral developer persona. The agent SHALL include the team context (Morgan, Casey, Riley) and shared partials (parallel-awareness, project-conventions, project-gotchas, testing-standards, design-skills). The orchestrator assigns persona names (Jordan, Alex, Sam, Taylor) for log identification, but all use the same `implementation-agent` template.

#### Scenario: Implementation agent prompt
- **WHEN** the template engine renders `implementation-agent`
- **THEN** it SHALL produce a prompt containing project context variables, team member descriptions, definition of done, prohibited patterns, and all included partials

#### Scenario: Design skills partial included
- **WHEN** the implementation agent prompt is rendered
- **THEN** it SHALL include `{{>design-skills}}` which conditionally renders design workflow instructions based on `HAS_DESIGN_SKILLS`

### Principal Engineer (Morgan)
The system SHALL provide a principal engineer template named Morgan with a review-focused prompt. Morgan's prompt SHALL define review criteria across five areas: Correctness, Test Coverage, Code Quality, Security, and Architecture. Morgan SHALL respond with exactly one of two decisions: APPROVE or REQUEST_CHANGES (with Critical/Important/Minor severity categories).

#### Scenario: Morgan review criteria completeness
- **WHEN** the principal-engineer system prompt is rendered
- **THEN** it SHALL include review criteria sections for Correctness, Test Coverage, Code Quality, Security, and Architecture

#### Scenario: Morgan response format
- **WHEN** the principal-engineer system prompt is rendered
- **THEN** it SHALL instruct Morgan to respond with either APPROVE or REQUEST_CHANGES, with REQUEST_CHANGES structured into Critical, Important, and Minor sections

#### Scenario: Morgan config
- **WHEN** the principal-engineer config.json is read
- **THEN** the role SHALL be set and the allowed commands SHALL include read-only tools

### Security Agent (Casey)
The system SHALL provide a security agent template named Casey with an audit-focused prompt. Casey's prompt SHALL define vulnerability categories at four severity levels: Critical (hardcoded secrets, SQL injection, command injection, auth bypass, path traversal), High (XSS, insecure deserialization, broken access control), Medium (rate limiting, verbose errors, known CVEs), and Low (missing security headers). Casey SHALL produce structured findings reports and SHALL not fix code directly.

#### Scenario: Casey severity levels
- **WHEN** the security-agent system prompt is rendered
- **THEN** it SHALL define Critical, High, Medium, and Low severity categories with specific vulnerability types listed under each

#### Scenario: Casey output format
- **WHEN** the security-agent system prompt is rendered
- **THEN** it SHALL specify a structured findings format with Security Audit Summary counts and per-finding File/Issue/Risk/Recommendation fields

#### Scenario: Casey clean audit
- **WHEN** the security-agent system prompt is rendered
- **THEN** it SHALL instruct Casey that "No security issues found" is a valid outcome and to not manufacture findings

### PM Agent (Riley)
The system SHALL provide a PM agent template named Riley with two prompt modes: a standard system-prompt.md for mid-project work and a brain-dump-prompt.md for initial idea refinement. The standard prompt SHALL define a 5-step workflow for creating OpenSpec change proposals and roadmaps. The brain dump prompt SHALL define a 3-phase process: Listen and Ask (3-5 targeted questions per turn), Confirm Understanding, and Create Specs and Roadmap.

#### Scenario: Riley standard mode
- **WHEN** the pm-agent system-prompt.md is rendered
- **THEN** it SHALL instruct Riley to read project requirements, create OpenSpec change proposals (proposal.md, tasks.md, specs/), and optionally create a roadmap.md

#### Scenario: Riley brain dump mode
- **WHEN** the pm-agent brain-dump-prompt.md is rendered
- **THEN** it SHALL instruct Riley to ask probing questions (problem, MVP, integrations, data models, security, error scenarios), confirm understanding, then create specs and roadmap

#### Scenario: Riley team awareness
- **WHEN** either Riley prompt is rendered
- **THEN** it SHALL list the implementation agent (Developer), Morgan (Principal Engineer), and Casey (Security Specialist) as team members

### Spike Agent (Morgan)
The system SHALL provide a spike agent template using Morgan's persona with an investigation-focused prompt. The spike agent investigates technical unknowns by producing `openspec/spikes/<spike-id>/findings.md` with Question, Findings, Recommendation (PROCEED/ADJUST/HIGH-RISK), and optional POC evidence. The spike agent SHALL NOT implement the full feature — it stays focused on answering a specific technical question.

#### Scenario: Spike agent prompt content
- **WHEN** the spike-agent system prompt is rendered with `SPIKE_ID` and `SPIKE_DESCRIPTION` variables
- **THEN** it SHALL instruct Morgan to investigate the technical question, produce a findings.md file, and optionally create throwaway POC code in `openspec/spikes/<spike-id>/poc/`

#### Scenario: Spike agent config
- **WHEN** the spike-agent config.json is read
- **THEN** it SHALL contain `role: "spike"` and `name: "Morgan"`

### Shared Partials
The system SHALL provide reusable partial files in `templates/agents/_shared/`: `testing-standards.md` (happy path, edge cases, error cases, readable/independent tests), `risk-preflight.md` (pre-implementation risk assessment), `parallel-awareness.md` (coordination when multiple agents work concurrently), `project-conventions.md` (dynamically loaded project conventions), `project-gotchas.md` (dynamically loaded project-specific pitfalls), and `design-skills.md` (conditional design workflow instructions rendered via `DESIGN_SKILLS_SECTION` variable).

#### Scenario: Partial inclusion in implementation agents
- **WHEN** any implementation agent system prompt is rendered
- **THEN** it SHALL include shared partials via `{{>risk-preflight}}`, `{{>parallel-awareness}}`, `{{>project-conventions}}`, `{{>project-gotchas}}`, and `{{>testing-standards}}`

#### Scenario: Partial resolution by template engine
- **WHEN** the template engine encounters a partial reference like `{{>testing-standards}}`
- **THEN** it SHALL load `templates/agents/_shared/testing-standards.md`, trim trailing whitespace, and substitute the content in place of the placeholder

#### Scenario: Partial caching
- **WHEN** the same partial is referenced in multiple agent prompts during one engine instance
- **THEN** the template engine SHALL serve subsequent requests from its `_partialCache` Map rather than re-reading the file

#### Scenario: Missing partial handled gracefully
- **WHEN** a partial reference `{{>nonexistent}}` is encountered
- **THEN** the template engine SHALL leave the placeholder unchanged in the output

### Variable Substitution
The system SHALL replace `{{VARIABLE_NAME}}` placeholders in templates with project-specific values. Standard variables include `{{PROJECT_ID}}`, `{{PROJECT_DIR}}`, `{{TECH_STACK}}`, `{{GITHUB_REPO}}`, `{{CHANGE_NAME}}`, and `{{REQUIREMENTS}}`. Substitution SHALL use `String.replaceAll` to replace all occurrences of each variable.

#### Scenario: Project context injection
- **WHEN** a template containing `{{PROJECT_ID}}` and `{{PROJECT_DIR}}` is rendered with vars `{ PROJECT_ID: 'my-app', PROJECT_DIR: '/code/my-app' }`
- **THEN** all occurrences of `{{PROJECT_ID}}` SHALL be replaced with `my-app` and all occurrences of `{{PROJECT_DIR}}` SHALL be replaced with `/code/my-app`

#### Scenario: Variables applied after partial resolution
- **WHEN** `renderAgentPrompt` is called
- **THEN** partials SHALL be resolved first, then variable substitution SHALL be applied to the combined output (so variables inside partials are also replaced)

#### Scenario: renderString for non-template content
- **WHEN** `renderString(template, vars)` is called with a raw string and variables
- **THEN** it SHALL perform variable substitution without partial resolution

### Agent Config Structure
Each agent config.json SHALL contain at minimum: `role` (the agent's functional role), `name` (the persona name), and `model` (the Claude model identifier). Implementation agent configs SHALL include `permissions` specifying `canCreateFiles`, `canModifyCode`, `canInstallPackages`, and `canRunCommands` (array of allowed CLI commands). The PM agent config SHALL include `autoStart: true`, `maxTokens`, and permissions for `canCreateFiles`, `canModifySpecs`, and `canRunCommands`.

#### Scenario: Implementation agent config
- **WHEN** the implementation-agent config.json is read
- **THEN** it SHALL contain `role: "implementation"`, `name: "Developer"`, `model: "claude-sonnet-4-20250514"`, `temperature: 0.7`, `autoStart: false`, and permissions including `canRunCommands: ["npm", "node", "git", "openspec"]`

#### Scenario: PM agent config
- **WHEN** the pm-agent config.json is read
- **THEN** it SHALL contain `role: "pm"`, `autoStart: true`, `maxTokens: 4096`, and `permissions.canModifySpecs: true`
