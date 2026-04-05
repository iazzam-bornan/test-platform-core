# Architecture Overview

## High-Level Design

```
┌──────────────────────────────────────────────────────────────┐
│                        TestPlatform                          │
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                     │
│  │  Run 1  │  │  Run 2  │  │  Run N  │   Active Runs       │
│  └────┬────┘  └────┬────┘  └────┬────┘                     │
│       │            │            │                            │
│  ┌────▼────────────▼────────────▼────┐                      │
│  │           Event Emitter           │   status, log,       │
│  │                                   │   result, finished   │
│  └────┬──────────────────────────────┘                      │
│       │                                                      │
│  ┌────▼──────────────────────────────┐                      │
│  │           Storage Layer           │   save, get, list,   │
│  │   Memory │ SQLite │ Custom        │   update, delete     │
│  └───────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

## Core Components

### TestPlatform (`platform.ts`)

The main entry point. Responsibilities:
- Creating and tracking active runs
- Routing event subscriptions
- Managing the storage layer
- Merging active + stored run states for queries

### Run (`run.ts`)

Each `Run` instance manages the full lifecycle of a single test execution:

```
pending → booting → waiting_healthy → testing → passed/failed
```

Responsibilities:
- Generating Docker Compose files
- Starting and stopping Docker stacks
- Polling service health
- Monitoring the test runner container
- Parsing test results from container output
- Collecting service logs
- Handling cleanup/preservation

### Docker Module (`docker.ts`)

Low-level Docker and Compose operations:
- `generateComposeFile()` — Converts `RunConfig` into a Compose YAML
- `composeUp()` / `composeDown()` — Stack lifecycle
- `getContainerIds()` — Maps service names to container IDs
- `getContainerHealth()` — Queries Docker health status
- `streamContainerLogs()` — Real-time log streaming
- `getContainerExitCode()` — Checks test runner result

### Test Script Generator (`test-script.ts`)

When using `httpChecks`, generates a standalone Node.js script that:
- Iterates over URLs for N iterations
- Emits structured JSON results on stderr (prefixed with `@@RESULT@@`)
- Emits human-readable logs on stdout
- Exits with code 0 (all passed) or 1 (any failed)

### Storage (`storage/`)

Pluggable persistence layer:
- **MemoryStorage** — `Map`-based, default
- **SqliteStorage** — Uses Bun's native `bun:sqlite`
- **Custom** — Implement the `Storage` interface

## Data Flow

### Creating a Run

```
platform.createRun(config)
  │
  ├── Generate unique run ID
  ├── Create Run instance
  ├── Save initial state to storage
  └── run.execute() (background)
        │
        ├── BOOT
        │   ├── Create workspace directory
        │   ├── Generate test script (if httpChecks)
        │   ├── Generate docker-compose.yml
        │   └── docker compose up -d
        │
        ├── HEALTH
        │   ├── Poll container health every 3s
        │   ├── Emit service:health events on change
        │   └── Wait until all healthy (or timeout 5min)
        │
        ├── TEST
        │   ├── Wait for test-runner container
        │   ├── Stream logs & parse @@RESULT@@ lines
        │   ├── Wait for container exit
        │   └── Set status based on exit code
        │
        └── CLEANUP
            ├── Collect all service logs
            ├── Persist final state
            ├── Emit finished event
            └── Destroy or preserve based on CleanupConfig
```

### Docker Compose Generation

The platform converts your declarative config into a real Compose file:

```typescript
// Your config:
{
  infra: { postgres: { image: "postgres:16", ... } },
  services: { api: { image: "my-api", dependsOn: ["postgres"], ... } },
  test: { httpChecks: ["http://api:3000/health"] },
}

// Generated compose:
// name: tp-run_123_abc
// services:
//   postgres:
//     image: postgres:16
//     healthcheck: ...
//   api:
//     image: my-api
//     depends_on:
//       postgres:
//         condition: service_healthy
//   test-runner:
//     image: node:20-slim
//     command: ["node", "/test-script.mjs"]
//     volumes: ["/tmp/.../test-script.mjs:/test-script.mjs:ro"]
//     depends_on:
//       postgres: { condition: service_healthy }
//       api: { condition: service_healthy }
// networks:
//   default:
//     name: tp-run_123_abc-net
```

## Isolation Model

Each run gets:
- A unique project name (`tp-<runId>`)
- Its own Docker network (`tp-<runId>-net`)
- A dedicated workspace directory for compose files
- Independent containers that don't interfere with other runs

This means you can safely run multiple tests in parallel.
