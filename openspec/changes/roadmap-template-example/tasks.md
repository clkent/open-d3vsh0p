# Tasks: roadmap-template-example

1. [x] Create `templates/agents/_shared/roadmap-template.md` — complete TaskFlow example roadmap
2. [ ] Simplify `templates/agents/_shared/roadmap-rules.md` — add "How Your Roadmap Gets Used" section, remove verbose examples replaced by template, add closing reference to template
3. [ ] Add `{{>roadmap-template}}` include to `templates/agents/pm-agent/kickoff-prompt.md` after `{{>roadmap-rules}}`
4. [ ] Add `{{>roadmap-template}}` include to `templates/agents/pm-agent/brain-dump-prompt.md` after `{{>roadmap-rules}}`
5. [ ] Add `{{>roadmap-template}}` include to `templates/agents/pm-agent/system-prompt.md` after `{{>roadmap-rules}}`
6. [ ] Update `openspec/specs/pm-roadmap-granularity/spec.md` — add Roadmap Template Example requirement section
7. [ ] Update `openspec/roadmap.md` — add item to Phase IX Group D
8. [ ] Verify template passes `validateRoadmapFormat()` checks
9. [ ] Run `npm test` — full suite passes
