# CLI Interface — Delta Spec (inline-watch-mode)

## Modified Requirements

### Run Command --watch Flag
The `run` command SHALL accept a `--watch` boolean flag (default false). When set, agent activity SHALL be displayed inline in the terminal during execution.

#### Scenario: --watch flag parsed
- **WHEN** `./devshop run my-project --watch` is executed
- **THEN** `config.watch` SHALL be `true` and the orchestrator SHALL enable inline agent display

#### Scenario: --watch flag absent
- **WHEN** `./devshop run my-project` is executed without `--watch`
- **THEN** `config.watch` SHALL be `false` and no inline agent display SHALL occur

#### Scenario: --watch in help text
- **WHEN** `./devshop help` is executed
- **THEN** the usage output SHALL include `--watch` with description "Show live agent activity inline"
