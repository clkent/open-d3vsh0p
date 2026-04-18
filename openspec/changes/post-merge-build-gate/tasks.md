## Tasks

- [ ] Add `detectProjectType(projectDir)` function to `platform/orchestrator/src/quality/health-checker.js` that checks for `ios/Podfile`, `android/build.gradle`, and web framework configs, returning `{ type, platforms }` object
- [ ] Extend `detectHealthCheckCommands` to return `{ command, timeoutMs }` objects instead of plain strings, with 300000ms for native commands and 120000ms for JS commands. Maintain backward compatibility in `runHealthCheck` for plain string callers
- [ ] Modify `runPostMergeSmokeTest` in `health-gate.js` to run all detected commands (remove the `filter(c => !c.includes('build'))` line), using per-command timeouts from the command objects
- [ ] Add `healthCheck.postMergeBuild` config support: when `false`, `runPostMergeSmokeTest` filters to test-only commands; default is `true`
- [ ] Add tests for `detectProjectType` in `health-checker.test.js`: React Native iOS, React Native Android, dual-platform, web (Next.js), web (Vite), Node fallback, no package.json
- [ ] Add tests for extended `detectHealthCheckCommands` returning command objects with timeouts
- [ ] Add tests for `runPostMergeSmokeTest` running builds: default includes builds, opt-out filters them, per-command timeouts applied
- [ ] Add backward compatibility test: `runHealthCheck` with plain string commands still works with default timeout
