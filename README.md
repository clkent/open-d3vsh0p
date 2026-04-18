# d3vsh0p

An agent orchestration platform that uses the Claude Agent SDK to run AI agents that build software projects autonomously. Projects are spec-driven using OpenSpec, live in isolated repositories outside of d3vsh0p, and are managed through structured development cycles.

**Website:** [d3vsh0p.com](https://d3vsh0p.com)

**Important:** Orchestrator agents run with `bypassPermissions` enabled — they have full tool access within project directories. All agent work is reviewed by the principal engineer agent (Morgan) before merge. See [SECURITY.md](SECURITY.md) for the full trust model.

## Architecture

```
devshop/
├── active-agents/           # Per-project runtime state
│   └── {project-id}/
│       └── orchestrator/    # State machine state + session logs
├── platform/                # d3vsh0p platform code
│   └── orchestrator/        # The brain — Node.js state machine
├── templates/               # Blueprints copied when creating new projects/agents
│   ├── agents/              # Agent templates (system prompts + configs)
│   └── project-starter/     # Starter code for new projects
├── openspec/                # d3vsh0p's own specs
├── project-registry.json    # Index of all managed projects
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 20+
- An Anthropic API key (set `ANTHROPIC_API_KEY` in your environment)
- GitHub CLI (`gh`) — authenticated via `gh auth login`

### Install
```bash
git clone https://github.com/clkent/open-d3vsh0p.git
cd open-d3vsh0p/platform/orchestrator
npm install
```

### Your First Project
```bash
./devshop kickoff my-first-app
```

The `~/projects/` directory is created automatically on first kickoff.

## How It Works

The orchestrator reads a structured `openspec/roadmap.md` and organizes work into **phases** (ordered, with dependencies) containing **groups** (executed concurrently):

```
Phase I: Foundation
├── Group A: Database Setup     → Developer (worktree)
├── Group B: Auth System        → Developer (worktree)
└── Group C: API Scaffolding    → Developer (worktree)

Phase II: Features (depends on Phase I)
├── Group A: User Profiles      → Developer (worktree)
└── Group B: Search             → Developer (worktree)
```

Each group runs in its own git worktree with an assigned agent persona. Groups within a phase execute in parallel via `Promise.allSettled()`. Phases execute sequentially, respecting dependency chains. Merges are serialized through an async mutex to prevent conflicts.

Within each group, items are processed through **microcycles**:

```
Select Item → Implement → Verify Imports → Test → Commit → Convention Check → Review → Merge
      ↑                                                                          |
      +────────────────── retry (tests fail or review rejects) ──────────────────+
```

Each microcycle:
1. Picks the next pending item from the group
2. Runs an **implementation agent** (via Claude Agent SDK) to write the code
3. Verifies imports (catches hallucinated modules)
4. Runs the project's test suite
5. If tests pass, commits on a work branch
6. Checks project conventions (catches framework swaps)
7. Runs the **principal engineer agent** to review the diff
8. If approved, merges the work branch into the session branch
9. If rejected, feeds the review feedback back to the implementation agent and retries

Retries are capped. If exhausted, the requirement goes to a **parking lot** for human review.

### Spike Phases

When Riley identifies technical unknowns during kickoff (unfamiliar APIs, novel algorithms, architectural bets), she creates `[SPIKE]` items in a dedicated first phase. The orchestrator detects these and routes them to Morgan for investigation instead of the normal microcycle:

1. **Kickoff** — Riley creates `[SPIKE]` items in Phase I for genuine uncertainties
2. **Run** — Morgan investigates each spike, writes findings to `openspec/spikes/<id>/findings.md`
3. **Auto-pause** — Orchestrator pauses with `stopReason: spike_review_pending`
4. **Review** — User reads findings (locally or on GitHub PR)
5. **Resume** — `./devshop run <project> --resume` continues with implementation phases

Spikes bypass the microcycle — they use direct agent invocation on the session branch (no worktrees). Each spike produces a findings file with Question, Findings, Recommendation (PROCEED/ADJUST/HIGH-RISK), and optional POC evidence.

### Agent Roles

| Role | Persona | Responsibility | Authority |
|---|---|---|---|
| **PM** | Riley | Creates OpenSpec specs and roadmap from requirements | Write specs, manage roadmap |
| **Implementation** | Developer (x4) | Writes code, tests, commits | Full tool access in project dir |
| **Principal Engineer** | Morgan | Reviews code, approves/rejects | Merge authority, quality gate |
| **Security** | Casey | Scans for vulnerabilities, audits code | Read-only, reports findings |
| **Triage** | Drew | Classifies parked items as blocking/non-blocking | Read-only, no tools, JSON output |
| **Spike Investigator** | Morgan | Investigates technical unknowns before implementation | Write new files, read-only on existing |
| **Project Repair** | Morgan | Fixes baseline test/build failures before agents start | Full tool access in project dir |

Four implementation agents (named Jordan, Alex, Sam, Taylor for log identification) are assigned randomly to groups via the **AgentPool**, using a Fisher-Yates shuffle to maximize variety. All use the same system prompt template.

Agents are **stateless** — they're invoked fresh each time with a rendered system prompt via the Claude Agent SDK. The orchestrator maintains all state.

### Project Isolation

Projects live in `~/projects/`, not inside d3vsh0p. The `project-registry.json` maps project IDs to their directories:

```json
{
  "projects": [{
    "id": "proj-000-my-app",
    "name": "My App",
    "projectDir": "~/projects/my-app",
    "status": "active",
    "preview": {
      "command": "npm run dev",
      "port": 3000
    }
  }]
}
```

Each project is its own git repo, its own npm package, its own GitHub repository. d3vsh0p orchestrates the work but doesn't own the code. CLI commands accept either the full project ID (`proj-000-my-app`) or just the name portion (`my-app`).

### Preview Smoke Check

When a project has a `preview` field in its registry entry, the orchestrator runs a lightweight smoke check after each successful merge. It spawns the dev server, polls `http://localhost:<port>` for a response, and kills the process. If the server responds, the project is marked as previewable in the session state and morning digest.

- **Opt-in**: only runs if `preview.command` and `preview.port` are configured
- **Non-blocking**: failure is logged but never stops the session
- **Timeout**: defaults to 10 seconds, configurable via `preview.timeoutSeconds`

### Git Strategy

- **Session branch** (`devshop/session-{timestamp}`) — created from main, accumulates approved work
- **Work branches** (`devshop/work-{timestamp}/{requirement-id}`) — one per requirement, based on the session branch
- **Worktree branches** (`devshop/worktree-{sessionId}/group-{letter}`) — one per parallel group, temporary
- Implementation agents commit on work branches within their group's worktree
- Principal engineer reviews before merge to session branch
- Session branch is pushed to GitHub after each phase and at session end
- At session end, the session branch is auto-consolidated to main via PR (disable with `--no-consolidate`)

### OpenSpec as the Contract Layer

Every project uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for structured requirements. The PM agent (Riley) creates specs and a `roadmap.md` that organizes requirements into phases and groups. The orchestrator reads the roadmap to determine execution order and dependencies.

d3vsh0p itself also uses OpenSpec — see the `openspec/` directory in this repo.

## Usage

All commands accept either the full project ID (`proj-000-my-app`) or just the name (`my-app`).

### 1. Create a Project

```bash
./devshop kickoff my-app
./devshop kickoff my-app --design    # Install Impeccable design skills for frontend projects
```

Scaffolds a new git repo in `~/projects/`, registers it in `project-registry.json`, and drops you into an interactive chat with **Riley** (PM agent). Describe what you want to build, Riley asks clarifying questions, then type `go` — she creates OpenSpec specs and a roadmap. Type `push` to commit everything to GitHub.

Use `--design` to install [Impeccable](https://github.com/pbakaus/impeccable) design skills (typography, color, spacing, motion, responsive, UX writing) into the project's `.claude/skills/` directory. When design skills are present:

- **Implementation agents** run `/polish` on new/modified `.tsx`, `.vue`, `.svelte`, `.jsx` files and run `/audit` before their final commit
- **Morgan (reviewer)** scores a `design_quality` dimension assessing spacing, typography, color contrast (WCAG AA), and responsive patterns
- If you kick off a frontend project without `--design`, d3vsh0p suggests adding it

### 2. Refine Specs

```bash
./devshop plan my-app
```

Brain dump session with Riley. Share additional ideas or refine existing specs — she updates the specs and roadmap. Auto-resumes the previous session (use `--fresh` to start over). Type `push` when ready, `done` to save and exit.

### 3. Build It

```bash
./devshop run my-app
```

The core engine. Reads the roadmap, organizes work into **phases** (sequential) and **groups** (parallel within a phase). Each group gets its own git worktree and a randomly assigned implementation agent. For each item, runs the microcycle: implement, test, commit, review (Morgan), merge. Failed items go to a parking lot after max retries.

```bash
./devshop run my-app --budget 10 --time-limit 4    # Limit cost and time
./devshop run my-app --window night                  # Run in a specific time window
./devshop run my-app --requirements user-auth        # Work on specific items only
./devshop run my-app --resume                        # Resume an interrupted session
./devshop run my-app --no-consolidate                 # Skip auto-merge of session branch to main
```

### 4. Talk to Riley Mid-Project

```bash
./devshop talk my-app
```

Update specs or roadmap while development is in progress. Same interactive flow as `plan`.

### 5. Debug with Morgan

```bash
./devshop pair my-app
./devshop pair my-app --resume    # Resume a previous pair session
```

Interactive session with Morgan (principal engineer) to diagnose and fix issues. Morgan gets pre-loaded context: session state, roadmap progress, and parked items with failure reasons. Type `push` to commit Morgan's fixes to GitHub, or they auto-push when you type `done`.

### 6. Resolve Manual Items

```bash
./devshop action my-app
```

Interactive walkthrough of `[HUMAN]`-tagged roadmap items — things that need manual intervention like API keys, service configuration, or external setup. Guides you through each item and marks them complete in the roadmap.

Includes **runtime-discovered interventions**: when agents park items due to errors that need human action (code signing, missing credentials, toolchain issues), d3vsh0p automatically classifies them, generates step-by-step instructions, and surfaces them in the action command. Resolved interventions are automatically retried on `--resume`.

### 7. Recover from Crashes

```bash
./devshop recover my-app
```

Detects and cleans up orphaned resources left behind when a session crashes (OOM, power loss, force-kill). Removes orphaned worktrees under `.worktrees/`, deletes stale `devshop/*` branches from previous sessions, and reconciles `state.json` by clearing phantom active agents. Recovery also runs automatically at the start of every session.

On `--fresh` restart, before recovery deletes stale branches, the orchestrator extracts diffs from `devshop/work-*` branches for items that were parked due to infrastructure failures (timeout, SIGKILL, maxBuffer, etc.). These diffs are passed to the new agent as a starting point, avoiding duplicate work. Items parked due to code failures (test failures, review rejections) are not salvaged — the agent starts fresh to avoid anchoring on bad code.

### 8. Manage Scheduling

```bash
./devshop schedule install my-app    # Arm the daily cycle scheduler
./devshop schedule status my-app     # Show which windows are installed/loaded/paused
./devshop schedule pause my-app      # Temporarily stop all scheduled runs
./devshop schedule resume my-app     # Restart paused schedule
./devshop schedule remove my-app     # Fully remove the schedule
./devshop schedule dry-run my-app    # Preview what would be installed
```

Installs launchd plists (macOS) or cron entries (Linux) to run cycles automatically. Pause/resume lets you temporarily stop cycles without removing the configuration.

### 9. Maintenance Cadences

```bash
./devshop cadence run my-app --type weekly     # Stale branch cleanup, dead worktree removal
./devshop cadence run my-app --type monthly    # Archive parked items, cost review
./devshop cadence status my-app                # Show cadence config
```

### 10. Report Bugs or Request Features

```bash
./devshop report my-app              # Submit a bug report or feature request
./devshop report my-app --status     # Check report processing status
```

Queue bug reports (for Morgan) or feature requests (for Riley) while the orchestrator is running. Reports are processed at the safe point between phases — no git conflicts, no interrupting running agents. Morgan fixes bugs on the session branch (test-gated). Riley creates specs and adds roadmap items to future phases.

### 11. Security Scan

```bash
./devshop security my-app                          # Full security audit (Casey)
./devshop security my-app --focus secrets,deps      # Scan specific areas only
./devshop security my-app --budget 5 --timeout 10   # Override budget ($) and timeout (minutes)
./devshop security my-app --schedule weekly          # Schedule recurring scans (randomized day/time)
./devshop security my-app --unschedule               # Remove scheduled scans
```

Runs a standalone Casey security scan against a project. Findings are written to `openspec/scans/<date>-security.md` inside the project (not GitHub Issues, for security sensitivity). Focus areas: `secrets`, `deps`, `injection`, `auth`, `config`. Defaults: $2 budget, 5-minute timeout.

### 12. Check Status

```bash
./devshop status my-app
```

### Interactive Session Commands

During `kickoff`, `plan`, `talk`, and `pair` sessions, these commands are available:

| Command | Description |
|---|---|
| `go` | (kickoff only) Tell Riley to create specs and roadmap |
| `push` | Commit and push changes to GitHub (creates a PR and auto-merges) |
| `done` | Save session and exit (auto-pushes uncommitted changes) |

### Typical Workflow

1. **`./devshop kickoff my-app`** (add `--design` for frontend projects) — scaffold the repo, chat with Riley, type `go` to create specs, type `push` to commit
2. **`./devshop plan my-app`** — refine specs if needed, type `push` when ready
3. **`./devshop action my-app`** — resolve any `[HUMAN]` items (API keys, etc.)
4. **`./devshop run my-app`** — agents build from the specs in parallel
5. **`./devshop report my-app`** — while the orchestrator runs, queue bugs or feature requests
6. **`./devshop pair my-app`** — debug any issues with Morgan
7. **`./devshop schedule install my-app`** — arm the scheduler for autonomous daily cycles

## Testing

```bash
cd platform/orchestrator
npm test
```

A pre-commit hook automatically runs the orchestrator tests when files under `platform/orchestrator/` are modified. Tests also run in CI via GitHub Actions on every push and pull request.

## Consumption Monitoring

The orchestrator tracks cost, time, and invocation count as a **fuel gauge**. Before each item and between phases, it checks whether to continue or shut down gracefully. This prevents mid-operation crashes from account limits.

Defaults: $30/session budget, 7-hour time limit, 50 max agent invocations, warning at 80%.

## Graceful Pause

Press **Ctrl+C** during a running session to request a graceful pause. The orchestrator finishes its current work item, pushes to GitHub, writes the session summary, then stops. Press Ctrl+C a second time to force-exit immediately.

Sessions stopped via pause can be resumed with `--resume`.

## Triage Classification

When a phase completes with failed (parked) items, a lightweight triage agent (Drew) classifies each as **BLOCKING** or **NON_BLOCKING** for dependent phases. This prevents the orchestrator from wasting budget on agents that will inevitably fail because their dependencies are missing.

- Infrastructure, schema, and auth failures → blocking
- Cosmetic, docs, and isolated feature failures → non-blocking
- `[HUMAN]` tagged items → auto-parked as non-blocking (never sent to agents)
- Fail-safe: if triage fails, all items treated as blocking

Incomplete `[HUMAN]` items are surfaced at session end in an "Action Required" console section and included as a `humanItems` array in the summary JSON, so users always know what manual work remains.

## Runtime Intervention Discovery

When agents encounter errors that require human action (not code bugs), d3vsh0p automatically:

1. **Classifies** the error using zero-cost pattern matching — distinguishes "missing API key" from "SyntaxError"
2. **Generates instructions** — step-by-step actionable guidance with verify commands
3. **Annotates the roadmap** — adds `[HUMAN]` marker to the parked item
4. **Writes a sidecar file** — `openspec/interventions.json` persists across sessions
5. **Surfaces at session end** — console output shows exactly what to do, not just "Parked: 3"

Categories detected: credentials/API keys, permissions, database setup, code signing (iOS/Android), toolchain, simulator/device, dependencies. Mobile-specific patterns only activate when `ios/` or `android/` directories exist.

Run `./devshop action <project>` to walk through interventions interactively. Resolved interventions are automatically retried on `--resume`.

## Project Health Check

On fresh sessions (`--fresh` or first run), the orchestrator runs a **health check gate** before dispatching agents. This catches pre-existing test failures, broken builds, or missing dependencies — problems that would otherwise cause every agent to fail in a loop.

### How It Works

1. **Auto-detection** — reads `package.json` and auto-detects `npm test` and `npm run build` if those scripts exist
2. **Configurable** — override with explicit commands via project config (supports any test runner: Jest, Vitest, pytest, cargo test, etc.)
3. **Morgan repair** — if the health check fails, Morgan (principal engineer) is spawned to diagnose and fix the root causes
4. **Pair-mode fallback** — if Morgan can't fix it, the user drops into pair mode to fix it together
5. **Verification** — health check is re-run after each repair attempt; session only proceeds if all commands pass

### Configuration

In the project's `orchestrator/config.json` (inside `active-agents/<project-id>/`):

```json
{
  "healthCheck": {
    "commands": ["npm test", "npm run build"],
    "timeoutMs": 120000
  }
}
```

- `commands` — array of shell commands to run. If empty or omitted, auto-detection is used.
- `timeoutMs` — per-command timeout in milliseconds (default: 120000 / 2 minutes)

### State Flow

```
SELECTING_REQUIREMENT
  ├── (health check passes) → continue to phases
  └── (health check fails) → PROJECT_REPAIR
                                ├── Morgan fixes → SELECTING_REQUIREMENT
                                └── Morgan fails → pair mode
                                                    ├── user fixes → SELECTING_REQUIREMENT
                                                    └── still failing → SESSION_COMPLETE
```

Skipped on `--resume` sessions (the health check already ran when the session was first created).

## Security & Trust Model

See [SECURITY.md](SECURITY.md) for vulnerability reporting and the full trust model.

**Key points:** d3vsh0p is a local development tool. Orchestrator agents run with `bypassPermissions` — they have full tool access within project directories. All agent work is reviewed by the principal engineer (Morgan) before merge. Projects live in isolated repositories outside d3vsh0p. The PM agent's writes are sandboxed via SDK hooks.
