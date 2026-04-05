# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
