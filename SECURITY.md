# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in d3vsh0p, please [open an issue](https://github.com/clkent/open-d3vsh0p/issues/new) on GitHub.

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Scope

This policy covers the d3vsh0p orchestrator platform (`platform/`), agent templates (`templates/`), and CLI tooling. It does not cover projects built by d3vsh0p agents, which live in separate repositories.

## Trust Model

d3vsh0p orchestrates AI agents (via the Claude Agent SDK) that have full tool access within project directories. The orchestrator runs agents with `bypassPermissions` enabled — agents can read, write, and execute commands without interactive approval.

**What this means:**
- Implementation agents have unrestricted access within the project directory
- The principal engineer (Morgan) reviews all changes before merge
- The PM agent (Riley) writes are sandboxed to the project directory via SDK PreToolUse hooks
- The orchestrator itself runs as the local user — it has whatever filesystem and network access the user has

**Mitigations:**
- Projects live in isolated repositories outside the d3vsh0p directory
- Agent prompts instruct agents to operate only within their assigned project
- Git worktrees provide filesystem isolation between parallel agents
- Health checks gate the session — broken projects are caught before agents start looping
- All agent work goes through code review (Morgan) before merge

This is a local development tool, not a multi-tenant service. It trusts the local user and the Claude API.
