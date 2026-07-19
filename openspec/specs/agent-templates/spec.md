# Agent Templates

## Purpose
Provides persona-based system prompts and configuration for all agent roles in the DevShop orchestrator. Each agent type has a dedicated directory containing prompt templates and a config.json. The template inventory is: `pm-agent` (Riley), `principal-engineer` (Morgan), `security-agent` (Casey), and `_shared` reusable partials. Variable substitution injects project-specific context at render time.

## Status
IMPLEMENTED

## Source Files
- `templates/agents/principal-engineer/system-prompt.md` -- Morgan review persona prompt
- `templates/agents/principal-engineer/run-prompt.md` -- Morgan's orchestration prompt for run sessions
- `templates/agents/principal-engineer/pair-prompt.md` -- Morgan's pair session prompt
- `templates/agents/security-agent/system-prompt.md` -- Casey persona prompt
- `templates/agents/pm-agent/system-prompt.md` -- Riley standard PM prompt
- `templates/agents/pm-agent/brain-dump-prompt.md` -- Riley brain dump session prompt
- `templates/agents/pm-agent/kickoff-prompt.md`, `bootstrap-prompt.md`, `talk-prompt.md` -- Riley kickoff, bootstrap, and mid-project prompts
- `templates/agents/*/config.json` -- per-agent role configuration
- `templates/agents/_shared/` -- shared partials (roadmap rules and template, spec/project formats, roadmap execution rules, sub-agent delegation, design skills)
- `platform/orchestrator/src/agents/template-engine.js` -- TemplateEngine with partial resolution and variable substitution

## Requirements

### Template Directory Structure
The system SHALL organize agent templates such that each agent type has its own directory under `templates/agents/` containing its prompt templates and a `config.json` file. The directory name SHALL match the `agentType` identifier used by the orchestrator. The agent type directories SHALL be `pm-agent`, `principal-engineer`, and `security-agent`, with shared partials under `_shared/`.

#### Scenario: Agent directory resolution
- **WHEN** the template engine renders agent type `security-agent`
- **THEN** it SHALL read from `templates/agents/security-agent/system-prompt.md`

#### Scenario: Config file per agent
- **WHEN** `getAgentConfig('security-agent')` is called
- **THEN** it SHALL return parsed JSON from `templates/agents/security-agent/config.json` containing `role`, `name`, `temperature`, and `permissions`

#### Scenario: Missing config file handled gracefully
- **WHEN** `getAgentConfig` is called for an agent type with no config.json
- **THEN** it SHALL return an empty object `{}` without throwing

### Principal Engineer (Morgan)
The system SHALL provide a principal engineer template named Morgan. Morgan's `system-prompt.md` SHALL define a review-focused persona with a structured JSON response format: a `decision` of exactly APPROVE or REQUEST_CHANGES, dimensional scores (1-5) for spec_adherence, test_coverage, code_quality, security, simplicity, and implementation_authenticity, a summary, and issues with `critical`/`major`/`minor` severities. Additional Morgan prompts SHALL cover run orchestration (`run-prompt.md`) and pair sessions (`pair-prompt.md`).

#### Scenario: Morgan review scoring dimensions
- **WHEN** the principal-engineer system prompt is rendered
- **THEN** it SHALL include a scoring rubric covering spec_adherence, test_coverage, code_quality, security, simplicity, and implementation_authenticity

#### Scenario: Morgan response format
- **WHEN** the principal-engineer system prompt is rendered
- **THEN** it SHALL instruct Morgan to respond with a JSON block whose `decision` is either APPROVE or REQUEST_CHANGES, with issues categorized as critical, major, or minor

#### Scenario: Morgan run prompt partials
- **WHEN** the principal-engineer run-prompt.md is rendered
- **THEN** it SHALL include the `{{>roadmap-execution-rules}}` and `{{>sub-agent-delegation}}` shared partials

#### Scenario: Morgan config
- **WHEN** the principal-engineer config.json is read
- **THEN** it SHALL contain `role: "principal"` and `name: "Morgan"` with read-mostly permissions (`canModifyCode: false`)

### Security Agent (Casey)
The system SHALL provide a security agent template named Casey with an audit-focused prompt. Casey SHALL produce structured findings reports with a Security Audit Summary counting findings at four severity levels (Critical, High, Medium, Low) and per-finding File/Issue/Risk/Recommendation fields. Casey SHALL NOT fix code directly.

#### Scenario: Casey severity levels
- **WHEN** the security-agent system prompt is rendered
- **THEN** it SHALL define a Security Audit Summary with Critical, High, Medium, and Low counts

#### Scenario: Casey output format
- **WHEN** the security-agent system prompt is rendered
- **THEN** it SHALL specify a structured findings format with per-finding File/Issue/Risk/Recommendation fields

#### Scenario: Casey clean audit
- **WHEN** the security-agent system prompt is rendered
- **THEN** it SHALL instruct Casey that finding no issues is a valid outcome and to not manufacture findings

### PM Agent (Riley)
The system SHALL provide a PM agent template named Riley with multiple prompt modes: a standard system-prompt.md for mid-project work, a brain-dump-prompt.md for initial idea refinement, plus kickoff, bootstrap, and talk prompts. The standard prompt SHALL define a 5-step workflow for creating OpenSpec change proposals and roadmaps. The brain dump prompt SHALL define a 3-phase process: Listen and Ask, Confirm Understanding, and Create Specs and Roadmap.

#### Scenario: Riley standard mode
- **WHEN** the pm-agent system-prompt.md is rendered
- **THEN** it SHALL instruct Riley to read project requirements, create OpenSpec change proposals (proposal.md, tasks.md, specs/), and create or update a roadmap.md

#### Scenario: Riley brain dump mode
- **WHEN** the pm-agent brain-dump-prompt.md is rendered
- **THEN** it SHALL instruct Riley to ask probing questions, confirm understanding, then create specs and roadmap

#### Scenario: Riley roadmap partials
- **WHEN** any Riley prompt that produces a roadmap is rendered
- **THEN** it SHALL include the `{{>roadmap-rules}}` and `{{>roadmap-template}}` shared partials

### Shared Partials
The system SHALL provide reusable partial files in `templates/agents/_shared/`: `roadmap-rules.md` and `roadmap-template.md` (roadmap authoring rules and skeleton), `roadmap-execution-rules.md` (how Morgan works through a roadmap), `sub-agent-delegation.md` (rules for delegating groups to sub-agents with worktree isolation), `spec-format.md` and `project-format.md` (OpenSpec document formats), and `design-skills.md` (conditional design workflow instructions).

#### Scenario: Partial resolution by template engine
- **WHEN** the template engine encounters a partial reference like `{{>roadmap-rules}}`
- **THEN** it SHALL load `templates/agents/_shared/roadmap-rules.md`, trim trailing whitespace, and substitute the content in place of the placeholder

#### Scenario: Partial caching
- **WHEN** the same partial is referenced in multiple agent prompts during one engine instance
- **THEN** the template engine SHALL serve subsequent requests from its `_partialCache` Map rather than re-reading the file

#### Scenario: Missing partial handled gracefully
- **WHEN** a partial reference `{{>nonexistent}}` is encountered
- **THEN** the template engine SHALL leave the placeholder unchanged in the output

### Variable Substitution
The system SHALL replace `{{VARIABLE_NAME}}` placeholders in templates with project-specific values. Standard variables include `{{PROJECT_ID}}`, `{{PROJECT_DIR}}`, `{{TECH_STACK}}`, `{{GITHUB_REPO}}`, `{{ROADMAP_CONTENT}}`, and `{{HEALTH_STATUS}}`. Substitution SHALL use `String.replaceAll` to replace all occurrences of each variable.

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
Each agent config.json SHALL contain at minimum: `role` (the agent's functional role), `temperature`, `autoStart`, and `permissions` specifying `canCreateFiles` (or `canModifySpecs` for the PM agent), `canModifyCode` where applicable, and `canRunCommands` (array of allowed CLI commands). Persona-named agents (Morgan, Casey) SHALL include a `name` field.

#### Scenario: Principal engineer config
- **WHEN** the principal-engineer config.json is read
- **THEN** it SHALL contain `role: "principal"`, `name: "Morgan"`, `autoStart: false`, and permissions including `canRunCommands: ["git"]`

#### Scenario: PM agent config
- **WHEN** the pm-agent config.json is read
- **THEN** it SHALL contain `role: "pm"`, `autoStart: true`, `maxTokens: 4096`, and `permissions.canModifySpecs: true`
