# CLI Interface — Delta Spec (interactive-pair-interrupt)

## Modified Requirements

### Run Command Pair Hint
When stdin is a TTY, the `run` command session header SHALL display a hint: "Press p to pair with Morgan".

#### Scenario: TTY session shows hint
- **WHEN** `devshop run` is executed in a TTY terminal
- **THEN** the session header SHALL include "Press p to pair with Morgan"

#### Scenario: Non-TTY session omits hint
- **WHEN** `devshop run` is executed in a non-TTY environment
- **THEN** the session header SHALL NOT include the pair hint
