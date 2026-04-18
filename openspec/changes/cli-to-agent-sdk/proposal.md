## Why

DevShop spawns the `claude` CLI binary as a child process to run AI agents. This has proven fragile — the binary resolution depends on PATH, nvm, shell configuration, and environment variables. We've been debugging ENOENT spawn failures caused by nvm's bin directory not being in the DevShop process's PATH. Additionally, managing child process lifecycle (line buffering, JSON parsing, SIGTERM/SIGKILL, env var stripping) adds complexity that the SDK handles internally.

## What Changes

- **Replace CLI spawn with SDK**: `AgentRunner.runAgent()` now calls `@anthropic-ai/claude-agent-sdk`'s `query()` async generator instead of spawning a child process
- **Remove CLI resolution**: `_claudePath()` static method eliminated — no more scanning nvm dirs, /usr/local/bin, etc.
- **Remove env management**: `_buildChildEnv()` eliminated — no more stripping GIT_*, CLAUDE_CODE_*, NODE_TEST_CONTEXT vars. The SDK manages its own environment
- **Remove process lifecycle**: No more line buffering, newline-delimited JSON parsing, SIGTERM/SIGKILL two-phase kill, stdout/stderr accumulation
- **Timeout via AbortController**: Replaces setTimeout + process.kill with SDK-native AbortController support
- **Same return shape**: The `{ success, output, result, cost, duration, sessionId, error }` return object is unchanged — all consumers (agent-session, microcycle, security-runner, item-triage, parallel-orchestrator) work without modification

## Capabilities

### Modified Capabilities
- `agent-management`: Claude Agent SDK invocation replaces CLI spawning

## Impact

- `platform/orchestrator/package.json` — added `@anthropic-ai/claude-agent-sdk` dependency
- `platform/orchestrator/src/agents/agent-runner.js` — replaced spawn logic with SDK `query()` call
- `platform/orchestrator/src/agents/agent-runner.test.js` — rewritten to mock SDK instead of spawn
- `openspec/specs/agent-management/spec.md` — updated to reflect SDK invocation
- `openspec/specs/orchestrator-core/spec.md` — updated env whitelist section to SDK invocation
- `openspec/roadmap.md` — updated agent-management description
- `README.md` — updated architecture references from CLI spawning to SDK

No changes to: agent-session.js, microcycle.js, security-runner.js, item-triage.js, parallel-orchestrator.js, or any command files. The interface is unchanged.
