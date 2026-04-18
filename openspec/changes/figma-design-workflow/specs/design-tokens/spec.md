## ADDED Requirements

### Requirement: Canonical design tokens file
The system SHALL maintain a canonical design tokens file at `openspec/design-tokens.json` containing colors, spacing, border radii, and typography definitions in a tech-stack-agnostic JSON format.

#### Scenario: Token file generated at kickoff
- **WHEN** a project is created via `devshop kickoff` and the user selects a design approach
- **THEN** the bootstrap phase SHALL generate `openspec/design-tokens.json` with initial tokens appropriate to the chosen approach (wireframe: grayscale palette; creative: generated color palette; guided: user-specified colors)

#### Scenario: Token file structure
- **WHEN** design-tokens.json is read
- **THEN** it SHALL contain top-level keys `colors`, `spacing`, `borderRadius`, and `typography`, each with named key-value pairs

### Requirement: Tech-stack-specific token compilation
Implementation agents SHALL compile canonical tokens to the project's tech-stack-specific format when building UI components.

#### Scenario: Web with Tailwind
- **WHEN** the project uses Tailwind CSS
- **THEN** agents SHALL extend `tailwind.config.js` theme with values from design-tokens.json

#### Scenario: React Native
- **WHEN** the project uses React Native
- **THEN** agents SHALL generate a theme object (e.g., `src/theme.ts`) with values from design-tokens.json

#### Scenario: Plain CSS
- **WHEN** the project uses plain CSS or CSS modules
- **THEN** agents SHALL generate CSS custom properties in a `:root` block from design-tokens.json

#### Scenario: Swift/iOS
- **WHEN** the project uses Swift or SwiftUI
- **THEN** agents SHALL generate color assets and a constants file from design-tokens.json

### Requirement: Token injection into agent prompts
Design tokens SHALL be injected into implementation agent prompts alongside existing project context (conventions, tech stack, gotchas).

#### Scenario: Agent receives design tokens
- **WHEN** an implementation agent is invoked
- **THEN** the agent's system prompt SHALL include the current design tokens as a `DESIGN_TOKENS` variable

#### Scenario: Agent uses tokens over hardcoded values
- **WHEN** an implementation agent creates UI components
- **THEN** it SHALL reference design token values rather than hardcoding colors, spacing, or typography values

### Requirement: Token updates during reconciliation
The design reconciliation flow SHALL update `openspec/design-tokens.json` when the designer's changes imply new token values.

#### Scenario: Color change detected
- **WHEN** reconciliation detects that the designer changed the primary color from `#000` to `#22c55e`
- **THEN** the system SHALL update `colors.primary` in design-tokens.json to `#22c55e`

#### Scenario: New token category
- **WHEN** reconciliation detects design patterns not covered by existing tokens (e.g., shadows, opacity)
- **THEN** Riley SHALL add new token categories to design-tokens.json
