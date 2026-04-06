# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-04-06

### Added

- **Run queue** with bounded concurrency. Configure via `new TestPlatform({ maxConcurrentRuns: N })` — additional runs beyond the limit are queued FIFO until a slot frees up
- New `"queued"` status in `RunStatus` for runs waiting for a slot
- New `RunState.queuePosition` field — 1-indexed position in the queue, updated as the queue shifts
- New `setMaxConcurrentRuns(n)` method on `TestPlatform` for runtime reconfiguration
- New `getMaxConcurrentRuns()` and `getQueueStatus()` methods
- New `QueueStatus` type: `{ active, queued, max }`
- New `"queue:changed"` platform event emitted whenever the queue or active count changes
- New "live streaming" protocol bumps for HTTP, JMeter, and Cucumber test runners — results stream as tests run instead of arriving in a batch at the end
- New `"plan"` event type on `TestResult` — runners declare the expected total upfront via `RunState.plannedTotal` so the UI can render an accurate progress denominator

### Changed

- Slots are released only when a run's docker stack is fully torn down, OR explicitly destroyed via `destroyRun()` for preserved environments. Preserved runs hold their slot until destroyed
- `cancelRun()` now also handles queued runs — they are removed from the queue and marked cancelled without ever invoking docker
- `listRuns()` now includes queued runs (in addition to active and stored)

### Removed

- **`createParallelRuns()`** — gone. Callers should loop and call `createRun()` themselves; combined with `maxConcurrentRuns` this gives explicit control over concurrency

## [0.4.0] - 2026-04-05

### Added

- **Repo mode** for `CucumberTest` — clone a modular test repository at run time and execute a subset of its modules
- New `cucumber.repo` config: `{ url, ref?, modules, token? }` — set `MODULES`, `GIT_REPO_URL`, `GIT_REPO_REF`, and optional `GIT_TOKEN` env vars on the runner
- Repo convention: `modules/<name>/{features,pages,steps}`; `modules/shared/` is always loaded if present; a module without `features/` is a hard error
- Users own their repo's `cucumber.js` — the platform does not generate it. The repo config is expected to read `MODULES` and honour `RESULTS_FILE` (set to `/results/cucumber.json`) for result parsing
- Sample repo reference: <https://github.com/iazzam-bornan/taskboard-e2e-tests>
- Optional `repo.token` for cloning private repos (forwarded as `GIT_TOKEN`)

### Changed

- `CucumberTest.cucumber.features` is now optional — provide either `features` (local mode) or `repo` (repo mode)
- Default Cucumber runner image is now `ghcr.io/iazzam-bornan/test-platform-cucumber-runner:latest` (was `testplatform/cucumber-runner:latest`). Pull via `docker pull ghcr.io/iazzam-bornan/test-platform-cucumber-runner:latest`, or let Docker pull on first run

## [0.3.0] - 2026-04-05

### Added

- First-class Cucumber + Playwright E2E testing support via `CucumberTest` in the `TestConfig` union
- Declarative `cucumber` config: specify `features`, `steps`, `baseUrl`, `browser`, `headless`, `tags`, and custom `env` vars
- Custom runner image `testplatform/cucumber-runner:latest` (Playwright + Cucumber) with a built-in `CustomWorld` exposing `this.page`, `this.context`, `this.request`, and `this.baseUrl`
- Zero-boilerplate authoring: users provide only feature files and step definitions — no `package.json`, no `cucumber.js`, no World class
- TypeScript step definitions supported out of the box via pre-installed `ts-node`
- Importable `CustomWorld` type from `/runner/support/world` for full intellisense in TypeScript steps
- Automatic screenshot capture on scenario failure, attached to the Cucumber result
- Structured `@@RESULT@@` output with nested step details (`keyword`, `text`, `status`, `duration`, `error`)
- New `TestResult` fields: `feature`, `scenario`, `tags`, `steps`, `attachments`, and `skipped` (on summary)
- Configurable browser engines: `chromium` (default), `firefox`, `webkit`
- Cucumber `--tags` filter support for running subsets of scenarios

## [0.2.0] - 2026-04-05

### Added

- First-class JMeter load testing support via `JmeterTest` in the `TestConfig` union
- Declarative `jmeter` config: specify `testPlan`, `threads`, `rampUp`, `loops`, `duration`, `errorThreshold`, and custom `-J` properties
- Auto-generated shell script with JMeter image entrypoint override and test plan mounting
- Structured `@@RESULT@@` output parsing with fields: `label`, `url`, `responseCode`, `responseMessage`, `threadName`, `bytes`, `sentBytes`, `connectTime`, `latency`
- JMeter summary metrics: `errorRate`, `avgDuration`, `minDuration`, `maxDuration`, `p90Duration`, `p95Duration`
- Configurable JMeter Docker image (default: `justb4/jmeter:latest`)

## [0.1.0] - 2026-04-05

### Added

- `TestPlatform` class for orchestrating Docker-based test environments
- `Run` class with full lifecycle management (boot, healthcheck, test, cleanup)
- Docker Compose file generation from declarative config
- Three healthcheck types: HTTP, command, and TCP
- Built-in HTTP test runner with multi-iteration support
- Custom container test support
- Real-time event system (status, log, result, service:health, finished)
- `MemoryStorage` — in-memory storage backend
- `SqliteStorage` — SQLite storage backend using Bun's native SQLite
- Pluggable `Storage` interface for custom backends
- Parallel run support via `createParallelRuns()`
- Configurable cleanup policies (preserve/destroy on pass/fail)
- Run cancellation support
- Service dependency ordering with health-aware scheduling
- Container log collection after run completion
