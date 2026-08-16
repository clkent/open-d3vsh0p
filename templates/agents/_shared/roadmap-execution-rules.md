## How to Work Through the Roadmap

### Phase Order
- Phases execute in order. Check the `<!-- depends: Phase N -->` comments — a phase cannot start until its dependency phase has all items complete or parked.
- Within a phase, groups can be worked on independently (they don't depend on each other within the same phase).
- Work through items within each group sequentially.

### Item Lifecycle
For each pending item (`- [ ]`):
1. **Read the spec** — check `openspec/specs/<item-id>/spec.md` for detailed requirements. If no spec exists, use the item description from the roadmap.
2. **Read existing code** — understand current patterns before writing new code.
3. **Implement** — write the code, following project conventions.
4. **Test** — run the project's test suite. Fix any failures before proceeding.
5. **Commit** — use conventional commit format (`feat:`, `fix:`, `chore:`).
6. **Mark complete** — edit `roadmap.md` to change `- [ ]` to `- [x]` for this item, then commit.

### Skipping Items
- Skip items marked `[x]` (already complete).
- Skip items tagged `[HUMAN]` — these require manual action the developer must do.
- Incomplete `[HUMAN]` items in a dependency phase BLOCK dependent phases — do not start a phase whose dependency still has a pending `[HUMAN]` prerequisite; tell the developer to run `devshop action` instead. Exception: Group Z user-testing checkpoints are non-blocking.
- Parked items `[!]` — attempt these unless they're tagged `[HUMAN]`. They failed in a previous session and may need a different approach.

### When to Stop
Default to continuing. End the session ONLY when no remaining pending item can be completed as valuable work:
- All pending items in the roadmap are complete or parked, OR
- Every remaining pending item is blocked: it requires an incomplete `[HUMAN]` prerequisite, or it depends on parked work — continuing would produce work that can't be validated or would likely be redone.

Everything else is NOT a reason to stop:
- Reaching a phase boundary or a Group Z user-testing checkpoint is not a stopping point. Note the checkpoint for the developer (it stays `[ ]` for them) and continue directly into the next phase.
- Never end your turn with a status summary or "remaining work" recap while unblocked pending items remain — that stalls the whole run. Summarize only when actually stopping, and say what is blocked and why.
- A single blocked item is not a reason to stop — park it (`[!]`) and move on.

### Parking an Item
If you cannot complete an item (persistent test failures, missing dependencies, external service needed):
1. Mark it as parked: change `- [ ]` to `- [!]` in roadmap.md
2. Commit with message: `chore: park <item-id> — <reason>`
3. Move to the next item
