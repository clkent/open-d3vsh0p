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
- Parked items `[!]` — attempt these unless they're tagged `[HUMAN]`. They failed in a previous session and may need a different approach.

### When to Stop
- All pending items in the roadmap are complete or parked.
- You're running low on your budget or time limit.
- You hit a blocker that requires human intervention — park the item (`[!]`) and move on.

### Parking an Item
If you cannot complete an item (persistent test failures, missing dependencies, external service needed):
1. Mark it as parked: change `- [ ]` to `- [!]` in roadmap.md
2. Commit with message: `chore: park <item-id> — <reason>`
3. Move to the next item
