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
./devshop run my-app --no-auto-resume      # Don't wait out usage-limit stops
```

Spawns Morgan to work through the roadmap. There is no session time limit or budget — the run continues until the roadmap is done, Morgan ends the session, or you stop it (Ctrl+C or /exit). Session branch auto-consolidates to main via PR when Morgan finishes.

If your account's Claude usage limit stops Morgan mid-session, the run doesn't die: the orchestrator detects the stop (frozen session or early exit), prints `usage limit hit — next probe at HH:MM (Ctrl+C to stop)`, polls every 15 minutes, and resumes Morgan with full context once the limit window resets. You don't need to answer the limit dialog in Morgan's session — the orchestrator terminates and resumes it automatically. Waits are bounded (max ~5.5h, max 2 auto-resumes per run, never past a scheduled window's end), and a single Ctrl+C during the wait ends the run normally. Pass `--no-auto-resume` to turn this off.

Morgan also stops on his own sometimes — most often when Claude Code injects its "usage limit approaching — checkpoint now" instruction, which makes him wrap up with a summary and wait for input. Since an interactive session never exits at the end of a turn, the run would otherwise sit idle forever. The orchestrator detects the idle session and continues Morgan automatically (`--resume` with a keep-going prompt) as long as the roadmap still has unblocked pending work. A continuation counts as progress only if it completes or parks one of the unblocked items that justified it; side commits don't count. Three futile continuations in a row end the run, and the session summary reports `Continues: N`. Phase `depends` comments may carry a note after the reference (`<!-- depends: Phase III; blocked on a vendor account -->`); only the `Phase N` references are dependencies, and a reference to a phase that doesn't exist blocks the phase. A pending Group Z user-testing checkpoint never blocks the next phase, matching Morgan's own rules, so leaving a checkpoint open for yourself doesn't stall unattended runs.

For unattended runs (overnight), keep the Mac awake — the orchestrator can't poll while the machine sleeps: `caffeinate -i ./devshop run my-app`.

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

Shows roadmap progress, completed/pending/parked items, and active session state.

## Typical Workflow

1. `./devshop kickoff my-app` — scaffold, chat with Riley, type `go`
2. `./devshop run my-app` — Morgan builds from the roadmap
3. `./devshop talk my-app` — refine specs or roadmap if needed
4. `./devshop pair my-app` — debug issues with Morgan
5. `./devshop run my-app --resume` — continue building

## Use from your phone

Every interactive session (kickoff, talk, pair, run) can also be opened in the Claude app or at claude.ai/code through Claude Code's built-in [Remote Control](https://code.claude.com/docs/en/remote-control). The session keeps running on your Mac; the app shows the same conversation, forwards Morgan's questions and permission prompts, and can push a notification when he needs a decision.

Turn it on for one session:

```bash
./devshop run my-app --remote-control
```

Or for every session on this machine, in a gitignored `config.local.json` at the repo root:

```json
{ "remoteControl": { "enabled": true } }
```

A per-project `active-agents/<project>/orchestrator/config.json` can override the machine setting either way. Sessions appear in the app's Code tab under their agent and project name (`Morgan — my-app`, `Riley — my-app`), and the flag is kept when a run respawns Morgan after a usage-limit wait or an idle continuation.

Requirements: sign in with `claude auth login` using a claude.ai account (an API key or `claude setup-token` token cannot establish Remote Control). To get push notifications, run `/config` inside a session and enable **Push when actions required**. If Remote Control cannot connect, the session still runs normally in the terminal and shows a failure notice.

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

When scheduled, Morgan runs autonomously in time windows (night, morning, day); each windowed run stops at its window's end hour.

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
./devshop cadence run my-app --type monthly    # Disabled pending token-based estimator
```

### Project Health Check

`run` executes the project's health check (tests + build, auto-detected or from `healthCheck` config — including native iOS/Android builds) at both ends of a session:

- **Before spawning Morgan** — if the baseline is already broken, the failure output is injected into Morgan's prompt and repairing it becomes his first task.
- **After Morgan exits** — the closing gate. If the session broke something Morgan didn't catch, Morgan is re-entered to repair it (up to 2 attempts, 15 min each). If it still fails, the session branch is **not** consolidated to main — fix interactively with `pair`, then consolidate with `run --resume`.

### Session Duration

Runs have no time limit or budget — they continue until the roadmap is done or you stop them. Use Ctrl+C or /exit to end the session — resume later with `--resume`. Scheduled window runs stop at the window's end hour. (`devshop security --budget` still caps security scans.)

## Security & Trust Model

See [SECURITY.md](SECURITY.md) for the full trust model. d3vsh0p is a local development tool. Agents run with full tool access within project directories. Projects live in isolated repositories outside d3vsh0p.
