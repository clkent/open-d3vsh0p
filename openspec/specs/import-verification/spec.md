# Import Verification

## Purpose
Adds a fast, automated check after implementation that verifies all imports/requires in changed files resolve to actual modules. This catches the most common hallucination -- agents importing modules, functions, or types that don't exist in the project. The check runs before `npm test`, providing clearer error messages than a cryptic module-not-found test failure.

Addresses: **Hallucinations (#2)**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/import-verifier.js` -- ImportVerifier class that checks import resolution
- `platform/orchestrator/src/microcycle.js` -- Updated to run import verification before tests

## Requirements

### Import Extraction
The ImportVerifier SHALL extract all import/require statements from changed files in the git diff.

#### Scenario: ES module imports
- **GIVEN** a changed file containing `import { UserService } from '../services/user-service'`
- **WHEN** the verifier extracts imports
- **THEN** it SHALL record a relative import to `../services/user-service`

#### Scenario: CommonJS requires
- **GIVEN** a changed file containing `const db = require('./lib/db')`
- **WHEN** the verifier extracts imports
- **THEN** it SHALL record a relative import to `./lib/db`

#### Scenario: Third-party package imports are skipped
- **GIVEN** a changed file containing `import express from 'express'`
- **WHEN** the verifier extracts imports
- **THEN** it SHALL NOT attempt to resolve this import (third-party packages are checked by npm install, not by us)

### Import Resolution
For each relative import extracted, the verifier SHALL check that the target file exists on disk.

#### Scenario: Import resolves to existing file
- **GIVEN** an import of `../services/user-service` from `src/routes/auth.ts`
- **AND** the file `src/services/user-service.ts` exists
- **WHEN** the verifier checks resolution
- **THEN** it SHALL pass

#### Scenario: Import resolves with extension inference
- **GIVEN** an import of `./utils` from `src/index.ts`
- **WHEN** the verifier checks resolution
- **THEN** it SHALL check for `./utils.ts`, `./utils.js`, `./utils/index.ts`, `./utils/index.js` (in that order)

#### Scenario: Import does not resolve (hallucinated module)
- **GIVEN** an import of `../services/payment-gateway` and no such file exists
- **WHEN** the verifier checks resolution
- **THEN** it SHALL return a failure: "Unresolved import: '../services/payment-gateway' in src/routes/checkout.ts -- this file does not exist"

### Integration with Microcycle
The import verification SHALL run after implementation but before `npm test`. If it finds unresolved imports, the errors are passed back to the agent as a retry.

#### Scenario: Unresolved imports trigger retry
- **GIVEN** the implementation produced two unresolved imports
- **WHEN** the import verification fails
- **THEN** the microcycle SHALL treat this as an implementation failure with error context:
  ```
  Import verification failed. The following imports reference files that do not exist:
  - '../services/payment-gateway' in src/routes/checkout.ts
  - '../utils/format-currency' in src/components/Price.tsx

  Either create these files or fix the imports to point to existing modules.
  ```
- **AND** this SHALL count against the implementation retry limit (not the test retry limit)

#### Scenario: All imports resolve
- **WHEN** the import verification passes
- **THEN** the microcycle SHALL proceed to the test step normally

### Verification Cost
The import verification SHALL be a pure file-system operation with zero agent cost and near-zero time cost.

#### Scenario: Check speed
- **WHEN** the verifier runs on a diff with 15 changed files
- **THEN** it SHALL complete in under 500ms
