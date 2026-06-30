### project.md Format

The orchestrator's requirements parser reads `project.md` to discover what needs to be built. It splits the file by `##` headers and expects `### ` sub-headers inside the Requirements section. If the format is wrong, the orchestrator will fail with a "missing requirements" error.

Your `project.md` MUST follow this structure:

```markdown
# Project: <Project Name>

## Overview
Brief description of what the project does, who it's for, and the core value proposition.

## Tech Stack
- Language/runtime (e.g. Node.js 20, Python 3.12)
- Framework (e.g. Express, FastAPI)
- Database (e.g. PostgreSQL, MongoDB)
- Any other key technologies

## Requirements

### Requirement Name
- Specific thing the implementation agent should build
- Another concrete requirement
- Each bullet becomes a task the agent acts on

### Another Requirement
- What the agent should implement
- Be specific enough that an agent knows when it's done

## Constraints
- Project-specific constraints (e.g. "must run on port 3000")
- Security requirements
- Performance targets
```

**Rules for the Requirements section:**
1. The section header MUST be exactly `## Requirements` (case-sensitive, h2)
2. Each requirement MUST be a `### ` header (h3) with a descriptive name
3. Each requirement MUST have one or more bullet points starting with `- ` describing what to implement
4. Requirement names become the basis for spec file names — use clear, kebab-case-friendly names (e.g. "User Authentication" becomes `user-authentication/spec.md`)
5. Do NOT nest requirements deeper than h3 — the parser ignores `####` and below
