## Why

DevShop builds functional software but has no design workflow. Projects get implemented with developer-default UI that's functional but unpolished. There's no way to involve a human designer in the loop — no mechanism to push what DevShop built into a design tool, let a designer iterate, and pull the refined designs back for implementation. Adding a Figma MCP integration creates a bidirectional design loop: DevShop generates initial UI at a configurable fidelity, the human refines it in Figma, and Riley specs the changes for DevShop to implement.

## What Changes

- **Design approach selection at kickoff**: Riley asks about design fidelity (wireframe-only, DevShop-creative, or guided with style input) and persists the choice as project-level design context that flows into all agent prompts
- **Design tokens generation**: Kickoff bootstrap generates a canonical design tokens file (colors, spacing, typography, radii) in the appropriate format for the project's tech stack (CSS variables, RN theme object, Tailwind config, etc.)
- **`devshop design` CLI command**: New top-level command with interactive capture mode — user navigates their running app, captures screens one at a time via Figma's Code-to-Canvas MCP, all pushed to a Figma file as editable layers
- **Design snapshot system**: Each capture session saves a snapshot of the design context at time of push, enabling diffing when designs come back
- **`devshop design --reconcile` flow**: Reads updated design context from Figma via MCP, diffs against saved snapshot, Riley analyzes changes and produces new specs + roadmap items + updated design tokens
- **Figma MCP integration**: Configuration and tooling for the Figma remote MCP server (Code-to-Canvas for pushing, `get_design_context` for reading)

## Capabilities

### New Capabilities
- `figma-design-workflow`: The design command, capture mode, Figma MCP integration, snapshot system, and reconciliation flow
- `design-tokens`: Canonical design token generation at kickoff, tech-stack-specific compilation, and token updates during design reconciliation

### Modified Capabilities
- `project-kickoff`: Riley asks design approach questions during kickoff; bootstrap generates design tokens
- `cli-interface`: New `design` command added to CLI

## Impact

- `platform/orchestrator/src/index.js` — new `design` command dispatch
- `platform/orchestrator/src/commands/design.js` — new command handler (capture mode + reconcile mode)
- `platform/orchestrator/src/design/` — Figma MCP client, snapshot management, design diffing
- `templates/agents/pm-agent/kickoff-prompt.md` — design approach questions
- `templates/agents/pm-agent/design-reconcile-prompt.md` — Riley's reconciliation prompt
- `openspec/specs/project-kickoff/spec.md` — new requirements for design approach Q&A
- `openspec/specs/cli-interface/spec.md` — new `design` command requirements
- `platform/orchestrator/config/defaults.json` — design-related defaults (Figma MCP config)
- MCP dependency: Figma remote MCP server (`https://mcp.figma.com/mcp`)
