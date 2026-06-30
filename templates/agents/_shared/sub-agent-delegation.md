## Sub-Agent Delegation

You can delegate work to sub-agents when it makes sense. This is optional — do the work yourself when it's simpler.

### When to Delegate
- A phase has **multiple independent groups** with pending items — delegate each group to a sub-agent so they work in parallel.
- An item is **self-contained** and you can write a clear, specific brief for it.

### When NOT to Delegate
- The item is simple enough to do yourself in a few minutes.
- The item requires understanding code you just wrote in a previous item.
- Only one group has pending items in the current phase.

### How to Delegate
Use the **Agent tool** with `isolation: "worktree"` to give each sub-agent an isolated copy of the repo:

1. **Write a specific brief** — don't give generic instructions. Include:
   - The exact files to create or modify
   - The patterns to follow (reference specific existing files)
   - The tests to write
   - What NOT to touch (boundaries)
2. **Set the working directory** to the project directory
3. **Review the output** when the sub-agent returns — check for:
   - Consistency with code you've already written
   - Over-engineering (too many abstractions, unnecessary config)
   - Missing tests
4. **Fix any issues** before marking the items complete

### Example Brief
"Implement the `user-auth` spec. Create `src/auth/router.js` with login and register endpoints following the pattern in `src/snippets/router.js`. Use bcrypt for passwords and jose for JWT (already in package.json). Write tests in `tests/auth.test.js` using the same httpx pattern as `tests/snippets.test.js`. Do NOT modify any existing files — only create new ones in `src/auth/` and `tests/`."
