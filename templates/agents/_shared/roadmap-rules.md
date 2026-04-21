### Roadmap Format

The roadmap MUST follow this exact format:

```markdown
# Roadmap: [Project Name]

## Phase I: [Label]

### Group A: [Label]
- [ ] `requirement-id` — Description of the work item
- [ ] `requirement-id` — Description of the work item

### Group B: [Label]
- [ ] `requirement-id` — Description of the work item

## Phase II: [Label]
<!-- depends: Phase I -->

### Group A: [Label]
- [ ] `requirement-id` — Description of the work item
```

**Roadmap rules:**
- `## Phase N: Label` — phases execute sequentially (Phase II waits for Phase I to finish)
- `### Group X: Label` — groups within a phase execute in parallel by separate agents
- `<!-- depends: Phase I -->` — explicit dependency (defaults to previous phase). Multiple dependencies: `<!-- depends: Phase IV, Phase V -->`
- `- [ ] \`requirement-id\` — Description` — individual work items
- requirement-ids must be kebab-case and unique across the entire roadmap
- Group items that can be built independently into the same phase
- Group items that must be built together (shared dependencies) into the same group
- NO time estimates anywhere

### How Your Roadmap Gets Used

Your `roadmap.md` is parsed by `roadmap-reader.js` which splits by `##` (phases) and `###` (groups). The orchestrator runs phases sequentially — Phase II waits for Phase I to finish. Groups within a phase run in parallel, each assigned to a separate AI agent. Every `- [ ]` item becomes a task: one agent implements it, writes tests, commits, and gets a code review — all automated, no human in the loop. If your format doesn't match what the parser expects, items get silently skipped or the validator rejects the roadmap entirely. Getting the structure right matters more than getting the prose right.

### CRITICAL: Writing Roadmaps for Agents

**One concern per item:**
- Each item should do ONE thing. If you use "and" to connect two features, they should probably be separate items
- "Create user registration form with validation" is one thing
- "Implement registration and login with session management" is three things — split them
- A good item touches 1-3 files and produces roughly 100-300 lines of implementation code plus tests
- If you're describing something that would need 5+ files or 500+ lines, split it

**Every spec must have a matching roadmap item:**
- If you create N spec files, the roadmap MUST have at least N items — one per spec capability
- NEVER bundle multiple specs into a single roadmap item, even if the features are related
- The orchestrator assigns one agent per roadmap item. Bundled items cannot be parallelized and force sequential work where parallel work was possible

See the complete template example that follows for properly sized and split items.

**Don't say "with tests" in descriptions:**
- Every item includes tests automatically — the orchestrator won't merge code without passing tests and a code review
- Use the description to describe the feature, not the process
- Bad: `- [ ] \`plant-search\` — Implement plant search with filtering and unit tests`
- Good: `- [ ] \`plant-search\` — Searchable plant list with name, type, and sun-exposure filters`

**Prefer vertical slices over horizontal layers:**
- Instead of "build all API endpoints, then build all UI forms," prefer "build the complete create-location flow (API + UI + validation)"
- Vertical slices produce working features sooner and catch integration issues in earlier phases
- Each slice should deliver a complete, demoable user flow

**Never create items agents can't do:**
- Agents can write code, tests, configs, and documentation
- Agents CANNOT: sign up for external services, obtain API keys, configure DNS, set up hosting accounts, conduct user testing, or do manual QA
- If something requires human action, mark it with `[HUMAN]` in the description: `- [ ] \`get-api-keys\` — [HUMAN] Obtain API keys for Trefle, OpenWeather, and USDA services`
- `[HUMAN]` items will be parked by the orchestrator so they don't block agent work
- Group all `[HUMAN]` items in their own group so they don't clutter agent work groups
- If an entire phase would be all `[HUMAN]` items (e.g., provisioning cloud infrastructure), that's valid — mark every item and the orchestrator will park the phase. The next phase's agent work will only start after you complete and unpark those items.

**Don't save testing for the end:**
- Each implementation item includes writing tests for that feature as part of the agent cycle
- Do NOT create a separate "Testing" or "QA" phase — this wastes an entire phase on work that should happen inline
- Integration tests can be a small group in the same phase as the features they test

**Add a user testing checkpoint to every phase:**
- Every phase ends with `### Group Z: User Testing` containing a single `[HUMAN]` checkpoint
- Use the ID convention `test-phase-N` (e.g., `test-phase-1`, `test-phase-2`)
- The checkpoint tells the human exactly what to manually verify after that phase's agent work completes
- These are auto-parked as `non_blocking` — they won't slow the orchestrator. They're surfaced at session end and via `devshop action`
- Group Z sorts last alphabetically, visually separating checkpoints from implementation groups

**Good checkpoint example:**
```markdown
### Group Z: User Testing
- [ ] `test-phase-2` — [HUMAN] Verify the create-location flow: go to /locations/new, enter a valid zipcode, confirm hardiness zone displays, submit, and verify the location appears on /locations
```

Checkpoints must be specific: name the pages/endpoints/flows, the inputs to use, and the expected outcomes. See the template example for well-written checkpoints.

**Groups in a phase MUST be independent:**
- Since groups run in parallel, no group may depend on output from another group in the same phase
- If Group B needs files, scaffolding, APIs, or any artifact that Group A creates, Group B belongs in the **next** phase
- Common trap: putting project scaffolding (`project-setup`) in the same phase as feature groups that write code into the scaffolded project. The feature agents start immediately and fail because the project doesn't exist yet
- When in doubt, put it in the next phase — an extra phase is cheaper than a failed parallel execution

**Keep phases lean:**
- 3-5 phases is ideal for an MVP. More phases = more sequential bottlenecks
- Maximize parallel groups within phases to speed up overall execution — but never at the cost of correctness (see "Groups in a phase MUST be independent" above)

**Target 4-5 items per group, maximum 10:**
- Prefer 4-5 items per group for fast parallel throughput
- Groups up to 10 items are acceptable when tests must run after the code they test (tests belong in the same group as their implementation, not a separate parallel group)
- Never exceed 10 items — if a group grows beyond 10, split it into a separate phase

**No kitchen-sink phases:**
- Don't dump everything remaining into a catch-all "Polish & Launch" phase
- Performance optimization, design system, error handling, and deployment are independent concerns — give them separate groups or phases
- Every phase should have the same structural discipline as Phase I

### Prioritization Principles

1. **Foundation first** — database, auth, and core models before features that depend on them
2. **Vertical slices over horizontal layers** — "create-location flow (API + form + validation)" beats "all API endpoints" then "all forms"
3. **Independent features in parallel** — if two features don't share code, they can be in the same phase as different groups
4. **One concern per item** — something one agent can implement, test, and get reviewed in one cycle. If you need "and" to describe it, split it
5. **Dependencies flow downward** — later phases depend on earlier phases, never the reverse
6. **No intra-phase dependencies** — groups within a phase run simultaneously. If any group depends on another group's output (files, scaffolding, APIs), they MUST be in separate phases

### Spike Items for Technical Uncertainty

Some features involve genuine technical unknowns — unfamiliar APIs, novel algorithms, or architectural bets where feasibility needs validation before committing to full implementation. For these, create `[SPIKE]` items that Morgan (principal engineer) will investigate before implementation begins.

**When to create spikes:**
- External API integrations with uncertain behavior (e.g., "Does the Stripe API support partial captures?")
- Unfamiliar technology where feasibility needs validation (e.g., "Can WebGL render 10k nodes smoothly?")
- Novel algorithms or complex data transformations (e.g., "Can we match plant images with <2s latency?")
- Architectural decisions that need prototyping (e.g., "Will a single SQLite DB handle our write volume?")

**When NOT to create spikes:**
- Standard CRUD operations
- Well-documented APIs with clear examples
- Familiar technology the team has used before
- Simple data modeling or form validation

**Format:**
```markdown
## Phase I: Spikes
### Group A: Technical Validation
- [ ] `spike-stripe-checkout` — [SPIKE] Validate Stripe checkout flow with test API keys
- [ ] `spike-webgl-perf` — [SPIKE] Test WebGL rendering performance with 10k plant nodes
```

**Rules:**
- Max 1-3 spike items per project — only for genuine unknowns
- `[SPIKE]` items are investigated by Morgan, not implementation agents
- The orchestrator auto-pauses after the spike phase for human review
- Spike descriptions must be specific about WHAT to investigate
- Spikes always go in the first phase (Phase I)
- If nothing is genuinely uncertain, skip the spike phase entirely — go straight to implementation

### Self-Audit Checklist

Before presenting the roadmap, verify ALL of the following:

1. **Spec-item alignment:** Count the spec files you created. Count the roadmap items. There must be at least as many roadmap items as spec files. If not, split bundled items.
2. **No bundled specs:** No single roadmap item should cover work from multiple spec files. If one item's description references capabilities from 2+ specs, split it.
3. **Group size:** No group has more than 4 items. Split oversized groups.
4. **Phase count:** 3-5 phases for MVP. If you have more, look for phases that can merge.
5. **Spike validation:** If you created spike items, verify they are genuinely uncertain (not just hard). No more than 3 spikes.
6. **Testing checkpoints:** Every phase has a `Group Z: User Testing` with a `test-phase-N` checkpoint. Descriptions are specific (pages, flows, expected outcomes), not vague.
7. **No intra-phase dependencies:** For each phase with multiple groups, verify that no group depends on output from another group in the same phase. If Group B needs files that Group A creates, move Group B to the next phase. Common case: project scaffolding must complete before feature groups can write code into it.

The complete example that follows demonstrates all of these rules in context.