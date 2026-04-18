## 1. Design Tokens Foundation

- [ ] 1.1 Define canonical design token JSON schema and create example `openspec/design-tokens.json`
- [ ] 1.2 Add design token compilation utilities for web/Tailwind (extend `tailwind.config.js` theme)
- [ ] 1.3 Add design token compilation for React Native (theme object in `src/theme.ts`)
- [ ] 1.4 Add design token compilation for plain CSS (`:root` custom properties)
- [ ] 1.5 Add design token compilation for Swift/iOS (constants file)
- [ ] 1.6 Add `DESIGN_TOKENS` variable injection into implementation agent prompt templates
- [ ] 1.7 Write tests for token compilation utilities (one per tech stack)

## 2. Kickoff Design Approach

- [ ] 2.1 Update Riley's kickoff prompt to ask design approach question (wireframe / creative / guided) for UI-bearing projects
- [ ] 2.2 Add logic to skip design question for non-UI projects (CLI tools, APIs, libraries)
- [ ] 2.3 Persist `designApproach` and `designGuidance` in `openspec/project.md`
- [ ] 2.4 Update bootstrap agent to generate `openspec/design-tokens.json` based on design approach
- [ ] 2.5 Update bootstrap to generate tech-stack-specific token file alongside canonical tokens
- [ ] 2.6 Inject design approach context into implementation agent prompts (alongside conventions/gotchas)

## 3. Figma MCP Client

- [ ] 3.1 Create `platform/orchestrator/src/design/figma-client.js` — thin wrapper around Figma remote MCP server
- [ ] 3.2 Implement `captureScreen()` — invoke `generate_figma_design` (Code-to-Canvas) for current viewport
- [ ] 3.3 Implement `readDesignContext(fileUrl, pageId)` — invoke `get_design_context` for a Figma page
- [ ] 3.4 Implement `readDesignTokens(fileUrl)` — invoke `get_variable_defs` for token extraction
- [ ] 3.5 Add MCP connection configuration to `platform/orchestrator/config/defaults.json`
- [ ] 3.6 Add error handling for MCP connection failures, rate limits, and timeouts
- [ ] 3.7 Write tests for figma-client (mocked MCP responses)

## 4. Design Capture Command

- [ ] 4.1 Add `design` command to CLI argument parser in `platform/orchestrator/src/index.js`
- [ ] 4.2 Create `platform/orchestrator/src/commands/design.js` — command handler
- [ ] 4.3 Implement dev server boot/detection (find running server or start via `npm run dev` / project config)
- [ ] 4.4 Implement interactive capture mode (c=capture, l=list, d=done, q=quit)
- [ ] 4.5 Integrate Code-to-Canvas capture via figma-client for each screen
- [ ] 4.6 Implement screen naming and Figma page organization
- [ ] 4.7 Add help text for `design` command to CLI help output
- [ ] 4.8 Write tests for design command (capture mode flow with mocked figma-client)

## 5. Design Snapshot System

- [ ] 5.1 Create `platform/orchestrator/src/design/snapshot-manager.js` — save/load/list snapshots
- [ ] 5.2 Implement snapshot save: capture design context for each screen and persist as timestamped JSON
- [ ] 5.3 Implement snapshot load: find most recent snapshot for a project
- [ ] 5.4 Store snapshots at `active-agents/<project-id>/orchestrator/design-snapshots/<timestamp>.json`
- [ ] 5.5 Write tests for snapshot manager (save, load, multiple snapshots)

## 6. Design Reconciliation

- [ ] 6.1 Implement `--reconcile` flag handling in design command
- [ ] 6.2 Create `platform/orchestrator/src/design/design-differ.js` — compare snapshot vs current Figma state
- [ ] 6.3 Implement per-screen diffing (structural changes, color changes, layout changes, new elements)
- [ ] 6.4 Create Riley reconciliation prompt template at `templates/agents/pm-agent/design-reconcile-prompt.md`
- [ ] 6.5 Implement Riley invocation to produce specs + roadmap items from detected changes
- [ ] 6.6 Implement design token update from reconciled changes (update `openspec/design-tokens.json`)
- [ ] 6.7 Implement design guidance update in `openspec/project.md` from reconciled changes
- [ ] 6.8 Display change summary to user before spec creation (with confirmation)
- [ ] 6.9 Handle "no changes detected" case gracefully
- [ ] 6.10 Handle "no snapshot exists" error case
- [ ] 6.11 Write tests for design-differ (mocked before/after contexts)
- [ ] 6.12 Write tests for reconciliation flow (end-to-end with mocked Figma + Riley)

## 7. Roadmap Update

- [ ] 7.1 Add `figma-design-workflow` and `design-tokens` to `openspec/roadmap.md` in a new phase
