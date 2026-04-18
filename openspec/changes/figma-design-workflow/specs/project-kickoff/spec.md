## ADDED Requirements

### Requirement: Design approach selection
During the kickoff Q&A, Riley SHALL ask the developer about their preferred design approach for UI-bearing projects.

#### Scenario: Riley asks design approach question
- **WHEN** Riley identifies that the project includes user-facing UI (web app, mobile app, desktop app)
- **THEN** Riley SHALL ask the developer to choose a design approach: wireframe-only (black & white, basic layout), DevShop-creative (DevShop picks a visual direction), or guided (developer provides style guidance)

#### Scenario: Wireframe approach selected
- **WHEN** the developer selects wireframe-only
- **THEN** Riley SHALL record `designApproach: "wireframe"` in `openspec/project.md` and instruct agents to produce grayscale, layout-focused UI with no color or visual styling

#### Scenario: Creative approach selected
- **WHEN** the developer selects DevShop-creative
- **THEN** Riley SHALL record `designApproach: "creative"` in `openspec/project.md` and generate a suggested color palette, typography, and visual direction based on the project's purpose and audience

#### Scenario: Guided approach selected
- **WHEN** the developer selects guided and provides style input (e.g., "dark theme, minimal, rounded corners, brand color #22c55e")
- **THEN** Riley SHALL record `designApproach: "guided"` and `designGuidance: "<user input>"` in `openspec/project.md`

#### Scenario: Non-UI project
- **WHEN** the project has no user-facing UI (CLI tool, API-only service, library)
- **THEN** Riley SHALL skip the design approach question entirely

### Requirement: Design tokens generation at bootstrap
The kickoff bootstrap phase SHALL generate an initial `openspec/design-tokens.json` file with tokens appropriate to the selected design approach and tech stack.

#### Scenario: Wireframe tokens
- **WHEN** the design approach is "wireframe"
- **THEN** bootstrap SHALL generate tokens with a grayscale palette (black, white, grays), standard spacing scale, minimal border radii, and system font stack

#### Scenario: Creative tokens
- **WHEN** the design approach is "creative"
- **THEN** bootstrap SHALL generate tokens with a generated color palette (primary, secondary, accent, background, text), a spacing scale, varied border radii, and a selected font pairing

#### Scenario: Guided tokens
- **WHEN** the design approach is "guided" with user-provided style input
- **THEN** bootstrap SHALL generate tokens incorporating the user's specified colors, style preferences, and any mentioned fonts

#### Scenario: Token format matches tech stack
- **WHEN** tokens are generated
- **THEN** the canonical `openspec/design-tokens.json` SHALL be created regardless of tech stack, and the bootstrap agent SHALL also create the tech-stack-specific token file (Tailwind config extension, RN theme object, CSS custom properties, or Swift constants)
