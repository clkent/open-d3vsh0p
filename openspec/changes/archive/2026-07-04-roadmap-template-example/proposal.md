## Why

Riley's roadmap output quality is inconsistent because the guidance is 183 lines of prose rules with scattered fragments. There's no single "here's what a complete, well-formed roadmap looks like" end-to-end example. LLMs learn formats better from one concrete example than from paragraphs of rules. Adding a canonical template and trimming redundant prose will improve Riley's first-attempt accuracy and reduce validation fix-loops.

## What Changes

- **New roadmap template partial**: A complete example roadmap for a fictional "TaskFlow" app demonstrating all structural rules (phases, groups, IDs, spikes, checkpoints, [HUMAN] items) in one cohesive document
- **Simplified roadmap-rules.md**: Remove verbose example blocks that the template now demonstrates; add a "How Your Roadmap Gets Used" section explaining the parser pipeline; trim from ~183 to ~120 lines
- **Template inclusion in PM prompts**: Add `{{>roadmap-template}}` partial include to kickoff-prompt.md, brain-dump-prompt.md, and system-prompt.md after their existing `{{>roadmap-rules}}` include

## Capabilities

### Modified Capabilities
- `pm-roadmap-granularity`: PM prompts SHALL include a complete roadmap template showing proper end-to-end structure

## Impact

- **Tokens**: Template adds ~50 lines to each PM prompt render (~600 tokens). Offset by ~60 lines removed from roadmap-rules.md. Net change is roughly neutral.
- **No code changes**: template-engine.js, pm-runner.js, roadmap-format-checker.js unchanged
- **Risk**: Low. Template is static content. Partial resolution is single-pass so no nesting issues.
