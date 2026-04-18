# Project Kickoff

## Purpose
Automate end-to-end project creation through an interactive session with Riley (PM agent). A developer describes what they want to build, Riley asks clarifying questions, then the system scaffolds the entire project: GitHub repo, code scaffold, OpenSpec specs, roadmap, and registry entry. This replaces the manual steps currently required to set up a new project in DevShop.

## Status
IMPLEMENTED

## Requirements

### Interactive Kickoff Session
The system SHALL provide a `kickoff` command that starts a guided conversation with Riley to understand what the developer wants to build. Riley SHALL run via the DevShop-level PM runner with read-only awareness of platform internals and write access sandboxed to the project directory.

#### Scenario: Developer describes a new project
- **WHEN** a developer starts a kickoff session and describes "I want to build a CLI tool for managing bookmarks"
- **THEN** Riley SHALL ask clarifying questions about tech stack, features, user personas, data models, and scope

#### Scenario: Iterative refinement
- **WHEN** Riley has asked initial questions and received answers
- **THEN** Riley SHALL summarize understanding, call out assumptions, list what's in scope vs out of scope, and ask for confirmation before proceeding

#### Scenario: Riley has DevShop context
- **WHEN** a kickoff session starts
- **THEN** Riley's system prompt SHALL include a "System Architecture" section containing the DevShop roadmap parser, validator, and agent template code so Riley can reason about output format requirements

#### Scenario: Kickoff from UI
- **WHEN** the web dashboard is available
- **THEN** the kickoff flow SHALL be triggerable from the UI with the same Q&A conversation rendered in a chat interface

### Project Scaffold Generation
The system SHOULD generate the full project structure based on the kickoff conversation output.

#### Scenario: GitHub repo creation
- **WHEN** Riley confirms the project plan with the developer
- **THEN** the system SHOULD create a private GitHub repo under the configured organization with a descriptive name and description

#### Scenario: Code scaffold
- **WHEN** the repo is created
- **THEN** the system SHOULD initialize it with the project starter template, customized based on the kickoff: package.json (name, description, scripts, engine), .gitignore, README.md, and entry point source file

#### Scenario: Tech stack detection
- **WHEN** the developer specifies a tech stack (e.g., "Node.js with Express" or "zero dependencies")
- **THEN** the scaffold SHOULD reflect that choice in package.json dependencies, scripts, and the project.md tech stack section

### Spec Generation
The system SHOULD generate OpenSpec capability specs from the kickoff conversation.

#### Scenario: Specs created from requirements
- **WHEN** Riley has confirmed the project plan
- **THEN** the system SHOULD create `openspec/project.md` with overview, tech stack, and requirements, plus individual `openspec/specs/<capability>/spec.md` files for each identified capability

#### Scenario: Spec quality
- **WHEN** specs are generated
- **THEN** each spec SHOULD include Purpose, Status (PLANNED), Requirements with SHALL/SHOULD language, and Scenarios with WHEN/THEN structure

#### Scenario: Appropriate granularity
- **WHEN** capabilities are identified from the kickoff
- **THEN** each capability SHOULD be scoped to a single reviewable unit of work — something one implementation agent can build, test, and get reviewed in one microcycle

### Roadmap Generation
The system SHOULD generate a phased roadmap from the identified capabilities.

#### Scenario: Roadmap with dependency ordering
- **WHEN** specs are generated
- **THEN** the system SHOULD create `openspec/roadmap.md` with phases ordered by dependency (foundation first, features that depend on it later)

#### Scenario: Parallel grouping
- **WHEN** multiple capabilities have no dependencies on each other
- **THEN** they SHOULD be placed in separate groups within the same phase so the orchestrator can build them concurrently

#### Scenario: Roadmap format
- **WHEN** the roadmap is generated
- **THEN** it SHOULD follow the exact format parsed by `roadmap-reader.js` (# Roadmap, ## Phase, ### Group, - [ ] `id` — description)

### Registry and Activation
The system SHOULD register the new project in DevShop and prepare it for orchestrator runs.

#### Scenario: Registry entry created
- **WHEN** the project scaffold is pushed to GitHub
- **THEN** the system SHOULD add an entry to `project-registry.json` with id, name, projectDir, githubRepo, registeredAt, and status "active"

#### Scenario: Active agents directory created
- **WHEN** the project is registered
- **THEN** the system SHOULD create the `active-agents/<project-id>/orchestrator/logs/` directory structure

#### Scenario: Ready for orchestrator
- **WHEN** the kickoff is complete
- **THEN** the project SHOULD be immediately runnable via `node platform/orchestrator/src/index.js run <project-id>`

### Conventions File Generation
The system SHOULD generate a project conventions file (`openspec/conventions.md`) during kickoff that contains actionable do/don't rules for implementation agents.

#### Scenario: Conventions derived from tech stack
- **WHEN** Riley generates specs after the kickoff Q&A
- **THEN** the system SHOULD also generate `openspec/conventions.md` with rules derived from the chosen tech stack (testing framework, styling approach, import style, ORM patterns, etc.)

#### Scenario: Conventions file verified
- **WHEN** `findMissingFiles()` checks for required openspec files
- **THEN** the system SHOULD report `openspec/conventions.md` as missing if it does not exist

#### Scenario: Missing conventions triggers retry
- **WHEN** `conventions.md` is missing after spec generation
- **THEN** the system SHOULD ask Riley to create it in a retry loop, same as other missing files

### Project ID Convention
The system SHOULD auto-generate project IDs following the `proj-NNN-<kebab-name>` convention.

#### Scenario: ID auto-increment
- **WHEN** a new project is created and the highest existing ID is `proj-000-test-app`
- **THEN** the new project SHOULD be assigned `proj-001-<name>`

#### Scenario: Kebab-case name
- **WHEN** the developer names the project "My Bookmark Manager"
- **THEN** the project ID SHOULD be `proj-001-my-bookmark-manager`

### Tech Stack Bootstrap

After spec generation succeeds and all required OpenSpec files are verified, the system SHALL run a bootstrap agent to install and configure the tech stack specified in `openspec/conventions.md`.

The bootstrap agent SHALL:
1. Read `openspec/conventions.md` and `openspec/project.md` to understand the tech stack
2. Install all dependencies implied by the conventions (framework, testing, styling, types, ORM, etc.)
3. Create configuration files required by the stack (e.g., `postcss.config.js`, `tsconfig.json`, `jest.config.js`, `tailwind.config.js`, `.eslintrc`)
4. Update `package.json` scripts to match the conventions (`dev`, `build`, `test`, `lint`)
5. Create a minimal smoke-test file so `npm test` passes with zero implementation code

The bootstrap agent SHALL operate in the project directory and commit no changes — the user controls when to commit via the existing "push" command.

#### Scenario: Next.js + Tailwind project bootstrap
- **WHEN** conventions.md specifies "Next.js 14 with App Router" and "Tailwind CSS for all styling"
- **THEN** the bootstrap agent SHALL install `next`, `react`, `react-dom`, `tailwindcss`, `autoprefixer`, and create `postcss.config.js`, `tailwind.config.js`, and `tsconfig.json` with appropriate content

#### Scenario: Conventions specify testing framework
- **WHEN** conventions.md specifies "Jest 30 with React Testing Library"
- **THEN** the bootstrap agent SHALL install `jest`, `@testing-library/react`, `@testing-library/jest-dom`, create `jest.config.js`, and update `package.json` so `npm test` runs Jest

#### Scenario: Conventions specify ORM
- **WHEN** conventions.md specifies "Prisma ORM"
- **THEN** the bootstrap agent SHALL install `prisma`, `@prisma/client`, create a minimal `prisma/schema.prisma`, and add `db:generate` and `db:push` scripts to `package.json`

### Post-Bootstrap Build Verification

After the bootstrap agent completes, the system SHALL run `npm run build` and `npm test` in the project directory to verify the tech stack is properly configured.

#### Scenario: Build and tests pass
- **WHEN** the bootstrap agent has configured the tech stack and both `npm run build` and `npm test` exit with code 0
- **THEN** the system SHALL display a success message and prompt the user to push

#### Scenario: Build fails after bootstrap
- **WHEN** `npm run build` or `npm test` fails after bootstrap
- **THEN** the system SHALL display the error output and allow the user to fix the issue interactively before pushing

### Riley Prompt Update

The kickoff prompt SHALL instruct Riley that a bootstrap agent will handle dependency installation and configuration. Riley SHOULD focus on documenting tech stack choices in conventions.md rather than running `npm install` commands during spec generation.

#### Scenario: Riley defers installation to bootstrap
- **WHEN** Riley creates conventions.md during spec generation
- **THEN** Riley SHALL document the tech stack choices (framework, versions, config patterns) without installing packages herself

### Project Context Loading

When a kickoff or plan session starts, the system reads all `.md` files from `<projectDir>/context/` and injects their contents into Riley's first-turn prompt via the `{{PROJECT_CONTEXT}}` template variable.

#### Scenario: Context files loaded on first turn
- **WHEN** the user's first message is sent during kickoff or plan
- **THEN** the system SHALL call `loadProjectContext(projectDir)` which reads all `.md` files from `<projectDir>/context/`, sorted alphabetically, concatenates them with `### <filename>` headers, and passes the result as `PROJECT_CONTEXT` in `templateVars`

#### Scenario: No context files
- **WHEN** the `context/` directory is missing or empty
- **THEN** `PROJECT_CONTEXT` SHALL be an empty string (no-op)

#### Scenario: Prompt template injection
- **WHEN** context files are loaded
- **THEN** the kickoff and brain-dump prompt templates SHALL render a "Project Brief" section with `{{PROJECT_CONTEXT}}` and an instruction reminding Riley to treat the content as input reference material, not as a format to emulate

#### Scenario: Scaffold includes context directory
- **WHEN** a new project is scaffolded
- **THEN** the project starter template SHALL include a `context/.gitkeep` file so the directory exists from the start

### Roadmap Format Validation

After spec generation, the system SHALL validate that `openspec/roadmap.md` follows the format required by the orchestrator's roadmap parser. If the format is invalid, the system SHALL ask Riley to fix it with specific diagnostics.

The validator SHALL detect structural emptiness: if parsing produces zero phases or zero total items, validation SHALL fail with an error identifying the likely cause (wrong heading levels, missing content).

When zero phases are parsed, the format checker SHALL scan raw markdown for wrong-level headings (e.g., `### Phase` instead of `## Phase`) and include line-number diagnostics in the error message so Riley knows exactly what to fix.

The format checker SHALL count spec files in `openspec/specs/` and compare to the total roadmap item count. If items < specs, it SHALL produce a warning indicating possible bundled items.

The validator SHALL warn when quality conventions are missing: no Group Z user testing checkpoint in any phase, or no `[HUMAN]` markers anywhere in the roadmap.

#### Scenario: All roadmap items use correct format
- **WHEN** Riley generates a roadmap where every checkbox item matches `- [ ] \`kebab-id\` — Description`
- **THEN** validation SHALL pass and the kickoff flow SHALL proceed to bootstrap

#### Scenario: Freeform checkbox items detected
- **WHEN** Riley generates a roadmap with freeform items like `- [ ] Create basic Swift project`
- **THEN** the system SHALL detect these as "near-misses", report the line number and diagnosis, and ask Riley to rewrite them in the correct format

#### Scenario: Retry loop for format issues
- **WHEN** the roadmap fails format validation
- **THEN** the system SHALL retry up to 3 times, sending Riley a fix prompt with line-by-line diagnostics and the expected format
- **AND** if still invalid after 3 attempts, SHALL warn the user and suggest `./devshop plan` for manual fixes

#### Scenario: Empty roadmap from wrong heading levels
- **WHEN** Riley generates a roadmap with `### Phase I:` instead of `## Phase I:` headings
- **THEN** the parser SHALL produce zero phases and the validator SHALL return an error: "No phases found in roadmap"
- **AND** the format checker SHALL scan the raw content, find the wrong-level headings, and include diagnostics like "Found `### Phase I: Setup` at line 5 — use `##` for phase headings"

#### Scenario: Empty roadmap with no content
- **WHEN** the roadmap file exists but contains only a title heading and no phases, groups, or items
- **THEN** the validator SHALL return an error: "No phases found in roadmap"

#### Scenario: Phases parsed but zero total items
- **WHEN** the roadmap has valid phase and group headings but no checkbox items under any group
- **THEN** the validator SHALL return an error: "No items found in roadmap — check item format: - [ ] \`id\` — description"

#### Scenario: Spec-count cross-check detects bundling
- **WHEN** Riley creates 7 spec files but the roadmap contains only 4 items
- **THEN** the format checker SHALL warn: "Roadmap has 4 items but project has 7 specs — items may be bundled (each spec should map to at least one roadmap item)"

#### Scenario: Spec-count cross-check passes
- **WHEN** Riley creates 5 spec files and the roadmap contains 12 items
- **THEN** the spec-count cross-check SHALL produce no warning (items >= specs is fine)

#### Scenario: Missing Group Z user testing checkpoint
- **WHEN** the roadmap has 3 phases but none contain a Group Z
- **THEN** the validator SHALL warn: "No Group Z (User Testing) checkpoints found — every phase should end with a Group Z: User Testing checkpoint"

#### Scenario: Missing HUMAN markers
- **WHEN** the roadmap has items for external service setup and manual testing but none are marked `[HUMAN]`
- **THEN** the validator SHALL warn: "No [HUMAN] items found — mark items requiring human action (API key setup, manual testing, service configuration) with [HUMAN]"

#### Scenario: Plan command blocks push on invalid roadmap
- **WHEN** the user types "push" during a plan session and the roadmap has format issues
- **THEN** the system SHALL display the issues and block the commit until the roadmap is fixed

#### Scenario: Plan command warns on exit with invalid roadmap
- **WHEN** the user types "done" during a plan session and the roadmap has format issues
- **THEN** the system SHALL display a warning but allow exit

### Riley Self-Validation During Kickoff

Riley's kickoff prompt SHALL include a self-validation step in Phase 3 (after file creation, before considering work complete). Riley SHALL verify her own output against the roadmap quality rules before the orchestrator's validation pipeline runs.

#### Scenario: Riley self-checks spec-item alignment
- **WHEN** Riley finishes creating specs and roadmap during kickoff
- **THEN** Riley SHALL count the spec files she created and verify the roadmap contains at least that many items
- **AND** if items < specs, Riley SHALL split bundled roadmap items before proceeding

#### Scenario: Riley self-checks Group Z checkpoints
- **WHEN** Riley finishes creating the roadmap during kickoff
- **THEN** Riley SHALL verify every phase has a `### Group Z: User Testing` section with a `[HUMAN]` checkpoint
- **AND** if any phase is missing Group Z, Riley SHALL add it before proceeding

#### Scenario: Riley self-checks HUMAN markers
- **WHEN** Riley finishes creating the roadmap during kickoff
- **THEN** Riley SHALL verify that items requiring external service setup, API key acquisition, or manual testing are marked with `[HUMAN]`

#### Scenario: Self-validation does not block on edge cases
- **WHEN** the project is a pure library with no external services or UI
- **THEN** Riley SHALL not add unnecessary `[HUMAN]` items — the self-check is advisory, not a rigid template

### Requirements Format Validation

After spec generation, the system SHALL validate that `openspec/project.md` contains a parseable `## Requirements` section with `### ` requirement headers and bullet points.

#### Scenario: Valid requirements section
- **WHEN** Riley generates a project.md with `## Requirements` containing `### Name` headers and `- ` bullet points
- **THEN** validation SHALL pass

#### Scenario: Missing requirements section
- **WHEN** project.md is missing the `## Requirements` header or uses a different name (e.g., `## Key Requirements`)
- **THEN** the system SHALL detect the issue, report it, and ask Riley to fix the format

#### Scenario: Requirements retry loop
- **WHEN** the requirements format fails validation
- **THEN** the system SHALL retry up to 3 times with a fix prompt showing the expected format

#### Scenario: Plan command blocks push on invalid requirements
- **WHEN** the user types "push" during a plan session and project.md has requirements format issues
- **THEN** the system SHALL block the commit and display the issues

### Frontend Tech Stack Design Suggestion
The kickoff command SHALL detect frontend-oriented tech stacks and suggest the `--design` flag when it was not explicitly provided. Detection SHALL match against known frontend framework keywords in the tech stack string.

#### Scenario: React project without --design flag
- **WHEN** a developer kicks off a project with tech stack containing "React" and does not pass `--design`
- **THEN** the system SHALL log a suggestion: "Tip: This looks like a frontend project. Consider re-running with --design to install design skills."

#### Scenario: Backend project
- **WHEN** a developer kicks off a project with tech stack containing only "Node.js, Express, PostgreSQL"
- **THEN** the system SHALL NOT suggest the `--design` flag

#### Scenario: Design flag already provided
- **WHEN** a developer kicks off a project with `--design` flag already set
- **THEN** the system SHALL NOT log the design suggestion (skills are already being installed)
