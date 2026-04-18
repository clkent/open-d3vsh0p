## Context

DevShop currently builds functional software through an orchestrated agent pipeline (kickoff → spec → roadmap → implement → test → review → merge) but has no design workflow. UI decisions are made implicitly by implementation agents with no human designer involvement. Figma recently shipped MCP server support with two key capabilities: Code-to-Canvas (push running browser UI to Figma as editable layers) and `get_design_context` (read structured design representations from Figma). This creates an opportunity for a bidirectional design loop.

The design workflow is intentionally **async and non-blocking** — it runs independently of the orchestrator. A human triggers it when ready, works in Figma at their own pace, and reconciles changes back when done.

## Goals / Non-Goals

**Goals:**
- Allow users to configure design fidelity at kickoff (wireframe, creative, guided)
- Generate tech-stack-appropriate design tokens during project bootstrap
- Provide interactive screen capture from a running app to Figma via Code-to-Canvas
- Enable design reconciliation: diff Figma changes against a saved snapshot and produce specs + roadmap items
- Keep design fully decoupled from the orchestrator — never blocks implementation

**Non-Goals:**
- Automated route discovery or full-app capture (user drives navigation and selects screens)
- Real-time sync between code and Figma (this is a manual trigger workflow)
- Figma-to-code generation (we read design context for diffing, not for code generation)
- Plugin API / Desktop MCP server support (remote MCP server only — no desktop app dependency)
- Design system component library management in Figma

## Decisions

### 1. User-driven capture over automated route walking

**Decision:** The user navigates their running app and captures screens one at a time via an interactive CLI mode.

**Alternatives considered:**
- Automated route discovery + Playwright walkthrough: fragile across frameworks, breaks on auth walls, seed data requirements, dynamic routes. Rate limits (6-7 MCP calls/session) make bulk capture risky.
- Manifest-driven capture: requires maintaining a screen manifest, still needs auth/state handling.

**Rationale:** The user already knows which screens matter and what state to show. Manual capture has one failure mode (Code-to-Canvas fails on a single screen, retriable). Automated capture has a dozen failure modes.

### 2. Remote MCP server only (no Desktop MCP dependency)

**Decision:** Use the Figma remote MCP server (`https://mcp.figma.com/mcp`) exclusively.

**Alternatives considered:**
- Desktop MCP server: selection-aware and supports Plugin API writes, but requires Figma Desktop app running, ties the workflow to a specific machine.
- Community MCP servers (REST API based): full API access but read-only — cannot create files/frames.

**Rationale:** Remote MCP is the only option that supports Code-to-Canvas (the push direction) and works without the Desktop app. For reading designs back, both remote and desktop work, but remote is simpler (URL-based context, no selection awareness needed).

### 3. Two-command design flow (capture + reconcile)

**Decision:** `devshop design <project>` for capture, `devshop design <project> --reconcile` for pulling changes back.

**Alternatives considered:**
- Single long-running command that waits for the designer: blocks a terminal, awkward UX for design work that may take hours/days.
- Three commands (capture, reconcile, apply): over-segmented, the "apply" is just `devshop run`.

**Rationale:** Two commands match the natural workflow. Capture is interactive (user navigates and captures). Reconcile is automated (Riley reads, diffs, specs). The gap between them is human design time — could be minutes or days.

### 4. Canonical design tokens with tech-stack compilation

**Decision:** Store tokens in a canonical JSON format (`openspec/design-tokens.json`), compile to tech-stack-specific format during implementation.

```json
{
  "colors": { "primary": "#22c55e", "background": "#0f172a" },
  "spacing": { "sm": "8px", "md": "16px", "lg": "24px" },
  "borderRadius": { "button": "9999px", "card": "12px" },
  "typography": {
    "heading": { "fontFamily": "Inter", "fontSize": "24px", "fontWeight": "700" },
    "body": { "fontFamily": "Inter", "fontSize": "16px", "fontWeight": "400" }
  }
}
```

**Target formats by tech stack:**
- Web/Tailwind: `tailwind.config.js` theme extension
- React Native: theme object in `src/theme.ts`
- CSS: custom properties in `:root`
- Swift/iOS: asset catalog + constants file

**Alternatives considered:**
- Store tokens in the native format only: loses the canonical source, makes reconciliation harder (Riley would need to parse CSS or Tailwind config).
- Use Style Dictionary: adds a build dependency for token compilation, overkill for this use case.

**Rationale:** A canonical JSON format is easy for Riley to read/write during reconciliation and easy for implementation agents to compile to any target format. The mapping is straightforward and doesn't need a build tool.

### 5. Snapshot-based diffing for reconciliation

**Decision:** Save full design context (from `get_design_context`) at capture time as a snapshot. On reconcile, read current Figma state and diff against the snapshot.

**Storage:** `active-agents/<project-id>/orchestrator/design-snapshots/<timestamp>.json`

```json
{
  "capturedAt": "2026-03-11T...",
  "figmaFileUrl": "https://figma.com/file/abc123",
  "screens": [
    {
      "name": "Dashboard",
      "captureContext": "...structured design representation at time of push..."
    }
  ]
}
```

**Rationale:** Figma has no built-in changelog or diff mechanism. The only way to know what changed is to compare before and after states ourselves. Storing the "before" at capture time is cheap and gives Riley a clear baseline for diffing.

### 6. Design approach as project-level context, updated on reconcile

**Decision:** Store design approach and guidance in `openspec/project.md` (new section). Update it during reconciliation when the designer's changes imply a style shift.

**Flow:**
1. Kickoff: Riley asks design approach → stored in project.md
2. All agents: read design context from project.md (injected into prompts like techStack/conventions)
3. Reconcile: Riley updates design guidance based on what the designer actually did
4. Future agents: pick up the updated guidance automatically

**Rationale:** This solves the "will agents forget?" concern. Design context lives in the same place as other project context (conventions, tech stack, gotchas) and gets injected into prompts the same way.

## Risks / Trade-offs

**[Code-to-Canvas fidelity]** → The DOM-to-Figma conversion may not perfectly represent the app's visual state (CSS effects, animations, complex layouts). Mitigation: This is a starting point for the designer, not a pixel-perfect capture. Imperfect conversion is acceptable.

**[Rate limits on Figma MCP]** → Figma caps MCP calls at ~6-7 per session on some plans. Mitigation: User-driven one-screen-at-a-time capture keeps call count low. A typical app has 5-15 key screens.

**[Reconciliation accuracy]** → Riley's ability to diff design context and produce good specs depends on the quality of `get_design_context` output. 85-90% inaccuracy reported for complex designs. Mitigation: Riley shows the detected changes to the user for confirmation before creating specs. User can correct misinterpretations.

**[Design tokens drift]** → Implementation agents might hardcode values instead of using tokens. Mitigation: Convention check (existing `automated-convention-check`) can verify token usage. Design guidance in prompts explicitly instructs agents to use tokens.

**[MCP server availability]** → Figma MCP is in beta and may change APIs. Mitigation: Isolate all MCP calls behind a thin client layer (`src/design/figma-client.js`) so API changes require updating one file.

**[Multi-platform token compilation]** → Compiling tokens to different tech stacks adds complexity. Mitigation: Start with web/Tailwind only. Add RN/Swift/CSS compilation as needed — the canonical JSON format makes this additive.
