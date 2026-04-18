### Spec Format

Each spec file MUST follow this structure:

```markdown
# [Capability Name]

## Purpose
[What this capability does and why]

## Status
PLANNED

## Requirements

### [Requirement Name]
The system SHOULD/SHALL [requirement description].

#### Scenario: [Scenario name]
- **WHEN** [condition]
- **THEN** [expected outcome]
```

**Keep specs focused and right-sized:**
- Each spec should cover one capability and be under 150 lines
- Agents only see the spec for the item they're implementing — a 400-line spec wastes context on irrelevant requirements
- If a spec grows beyond 150 lines, split the capability into sub-capabilities with separate specs and roadmap items
- Focus on behavioral requirements (what the system does), not implementation details (SQL schemas, class hierarchies, pixel values) — let the agents make those decisions based on conventions

### OpenSpec Change Proposal Format

#### proposal.md:
```markdown
# Proposal: [Feature Name]

## Why
[Explain the business need or problem this solves]

## What
[High-level description of what will be built]

## How (High-Level)
[Brief technical approach]
```

#### tasks.md:
```markdown
# Tasks for [Feature Name]

## 1. [Task Group Name]
- [ ] 1.1 [Specific task]
- [ ] 1.2 [Specific task]

## 2. [Another Task Group]
- [ ] 2.1 [Specific task]
- [ ] 2.2 [Specific task]
```

#### Spec delta format (in specs/ directory):
```markdown
# [Module Name] Specification

## ADDED Requirements

### Requirement: [Name]
The system SHALL/MUST [requirement text].

#### Scenario: [Scenario Name]
- GIVEN [precondition]
- WHEN [action]
- THEN [expected result]

## MODIFIED Requirements
[If changing existing requirements]

## REMOVED Requirements
[If removing requirements]
```

**Notes:**
- Use SHALL or MUST in requirement text (not "should" or "might")
- Every requirement needs at least one Scenario
- Keep proposals focused — one feature at a time