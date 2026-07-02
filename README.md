# d3vsh0p

**Open source AI code orchestration — turns product specs into tested, reviewed, and merged production code using Claude agents.**

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE) [![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-orange.svg)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk) [![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)

You define a product roadmap. d3vsh0p handles the rest — planning, implementation, testing, and merging. Morgan (the principal engineer) runs as a persistent Claude Code CLI session, reads the full roadmap, implements items sequentially with complete project context, and delegates to sub-agents when parallelism helps. It produces real commits, real PRs, and real production code.

**Website:** [d3vsh0p.com](https://d3vsh0p.com) · **Built by:** [Chelsea Kent](https://github.com/clkent) · **License:** [BSL 1.1](LICENSE)

## Quick Start

```bash
gh repo fork clkent/open-d3vsh0p --clone
cd open-d3vsh0p/platform/orchestrator && npm install
./devshop kickoff my-app    # Chat with Riley, describe your idea, type "go"
./devshop run my-app        # Morgan builds it
```

### Prerequisites
- Node.js 20+
- Claude Code CLI installed
- GitHub CLI (`gh`) — authenticated via `gh auth login`

## How It Works

Two agents, one workflow:

- **Riley** (PM) — Creates specs and a phased roadmap from your idea through interactive Q&A
- **Morgan** (Principal Engineer) — Reads the roadmap, implements items with full project context, tests, commits, and marks progress

Morgan reads `openspec/roadmap.md` — a structured plan organized into **phases** (sequential, with dependencies) containing **groups** (independent work within a phase):

```
Phase I: Foundation
├── Group A: Database Setup
├── Group B: Auth System
└── Group C: API Scaffolding

Phase II: Features (depends on Phase I)
├── Group A: User Profiles
└── Group B: Search
```

For each item, Morgan:
1. Reads the spec and existing code to understand patterns
2. Implements the feature
3. Runs the project's test suite
4. Commits with a conventional commit message
5. Marks the item complete in roadmap.md (`[ ]` → `[x]`)

When a phase has multiple independent groups, Morgan can delegate to sub-agents with specific, scoped briefs and worktree isolation. When items can't be completed, Morgan parks them (`[!]`) and moves on.

You can interact with Morgan during a run — ask questions, course-correct, or let it work autonomously on a schedule.

## Commands

### kickoff — Create a new project

```bash
./devshop kickoff my-app
./devshop kickoff my-app --design    # Add Impeccable design skills for frontend projects
```

Scaffolds a new repo, drops you into an interactive session with Riley. Describe what you want to build, Riley asks questions, type `go` to generate specs and roadmap. A bootstrap agent sets up the tech stack after Riley finishes.

### run — Build from the roadmap

```bash
./devshop run my-app
./devshop run my-app --resume              # Continue where you left off
./devshop run my-app --budget 10           # Limit spend (default: $30)
./devshop run my-app --time-limit 4        # Limit hours (default: 7)
```

Spawns Morgan to work through the roadmap. Session branch auto-consolidates to main via PR when Morgan finishes.

### talk — Chat with Riley mid-project

```bash
./devshop talk my-app
```

Interactive session with Riley to update specs, adjust the roadmap, or discuss the project. Riley has context about current progress. When you're done, exit and run `./devshop run` to continue building.

### pair — Debug with Morgan

```bash
./devshop pair my-app
./devshop pair my-app --resume
```

Interactive session with Morgan to diagnose and fix issues. Morgan has context about parked items and failure reasons.

### status — Check progress

```bash
./devshop status my-app
```

Shows roadmap progress, completed/pending/parked items, and latest session summary.

## Typical Workflow

1. `./devshop kickoff my-app` — scaffold, chat with Riley, type `go`
2. `./devshop run my-app` — Morgan builds from the roadmap
3. `./devshop talk my-app` — refine specs or roadmap if needed
4. `./devshop pair my-app` — debug issues with Morgan
5. `./devshop run my-app --resume` — continue building

## Testing

```bash
cd platform/orchestrator
npm test
```

Tests run automatically via pre-commit hook and GitHub Actions CI.

## Advanced Features

### Scheduling

```bash
./devshop schedule install my-app    # Set up automated daily runs via launchd/cron
./devshop schedule status my-app     # Show schedule status
./devshop schedule pause my-app      # Pause scheduled runs
./devshop schedule resume my-app     # Resume scheduled runs
./devshop schedule remove my-app     # Remove the schedule
```

When scheduled, Morgan runs autonomously in time windows (morning, afternoon, evening, night) with per-window budget and time limits.

### Design Skills

Use `--design` on kickoff to install [Impeccable](https://github.com/pbakaus/impeccable) design skills. Morgan runs `/impeccable polish` on UI files and `/impeccable audit` before committing.

### Action Items

```bash
./devshop action my-app
```

Walk through `[HUMAN]`-tagged roadmap items that need manual intervention (API keys, service setup, etc.). d3vsh0p auto-discovers these when Morgan encounters errors requiring human action.

### Security Scanning

```bash
./devshop security my-app
```

Standalone security audit via Casey (security agent). Findings written to `openspec/scans/`.

### Recovery

```bash
./devshop recover my-app
```

Clean up orphaned worktrees and stale branches after crashes. Also runs automatically at session start.

### Maintenance Cadences

```bash
./devshop cadence run my-app --type weekly     # Branch cleanup
./devshop cadence run my-app --type monthly    # Archive parked items, cost review
```

### Bug Reports

```bash
./devshop report my-app
```

Queue bug reports or feature requests while Morgan is working. Processed between phases.

### Project Health Check

On fresh sessions, Morgan runs a health check gate (tests + build) before starting work. If the check fails, Morgan attempts repair automatically. If that fails, you drop into pair mode to fix it together.

### Budget & Time Limits

Default: $30/session, 7-hour time limit. Morgan self-regulates and the orchestrator enforces a hard timeout. Press Ctrl+C for graceful pause — Morgan finishes current work, commits, and stops.

## Security & Trust Model

See [SECURITY.md](SECURITY.md) for the full trust model. d3vsh0p is a local development tool. Agents run with full tool access within project directories. Projects live in isolated repositories outside d3vsh0p.
