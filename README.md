# @testplatform/core

A TypeScript library for orchestrating Docker-based test environments. Define services, infrastructure, and test configurations — then let the platform spin up isolated Docker Compose stacks, run your tests, and report results.

## Features

- **Declarative test environments** — Define services, infrastructure, ports, healthchecks, and tests in a single config object
- **Docker Compose orchestration** — Automatically generates and manages Compose stacks per run
- **Health-aware scheduling** — Waits for all services to pass healthchecks before running tests
- **Built-in HTTP testing** — Point at URLs and get automated multi-iteration HTTP checks out of the box
- **Custom test containers** — Bring your own test image with arbitrary commands
- **Real-time events** — Stream status updates, logs, and test results as they happen
- **Pluggable storage** — In-memory (default) or SQLite persistence, or implement your own
- **Parallel runs** — Launch multiple isolated test environments simultaneously
- **Configurable cleanup** — Preserve or destroy environments based on pass/fail status

## Requirements

- [Bun](https://bun.sh) >= 1.3.11 (runtime)
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2

## Installation

```bash
bun add @testplatform/core
```

Or with npm/pnpm:

```bash
npm install @testplatform/core
pnpm add @testplatform/core
```

## Quick Start

```typescript
import { TestPlatform } from "@testplatform/core"

const platform = new TestPlatform()

// Subscribe to events
platform.on("status", (runId, status) => {
  console.log(`[${runId}] Status: ${status}`)
})

platform.on("log", (runId, line) => {
  console.log(line)
})

platform.on("result", (runId, result) => {
  console.log(`Test result:`, result)
})

// Create and start a run
const run = await platform.createRun({
  services: {
    api: {
      image: "my-api:latest",
      ports: [{ container: 3000, host: 3000 }],
      healthcheck: {
        type: "http",
        path: "/health",
        port: 3000,
      },
      dependsOn: ["postgres"],
    },
  },
  infra: {
    postgres: {
      image: "postgres:16",
      env: {
        POSTGRES_DB: "testdb",
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
      },
      ports: [{ container: 5432, host: 5432 }],
      healthcheck: {
        type: "command",
        command: ["pg_isready", "-U", "test"],
      },
    },
  },
  test: {
    httpChecks: ["http://api:3000/health", "http://api:3000/api/status"],
    iterations: 5,
    delayMs: 2000,
  },
  cleanup: {
    onPass: "destroy",
    onFail: "preserve",
  },
})

console.log(`Run started: ${run.id}`)
```

## Configuration

### RunConfig

The top-level configuration object for a test run.

```typescript
interface RunConfig {
  services: Record<string, ServiceConfig>  // Application services to test
  infra?: Record<string, ServiceConfig>    // Infrastructure dependencies
  test: TestConfig                          // Test definition
  cleanup?: CleanupConfig                   // Post-run behavior
}
```

### ServiceConfig

Defines a Docker service (application or infrastructure).

```typescript
interface ServiceConfig {
  image: string                         // Docker image
  env?: Record<string, string>          // Environment variables
  ports?: PortMapping[]                 // Port mappings
  healthcheck?: Healthcheck             // Health check configuration
  dependsOn?: string[]                  // Service dependencies
  volumes?: string[]                    // Volume mounts
}
```

### Healthchecks

Three healthcheck types are supported:

```typescript
// HTTP healthcheck — hits an endpoint
{ type: "http", path: "/health", port: 3000, interval: 5, timeout: 10, retries: 5 }

// Command healthcheck — runs a command inside the container
{ type: "command", command: ["pg_isready", "-U", "postgres"], interval: 5, timeout: 10, retries: 5 }

// TCP healthcheck — checks if a port is open
{ type: "tcp", port: 6379, interval: 5, timeout: 10, retries: 5 }
```

### TestConfig

Either built-in HTTP checks or a custom container:

```typescript
// HTTP checks — automated URL testing
{
  httpChecks: ["http://api:3000/health"],
  iterations: 10,   // default: 10
  delayMs: 1000,     // default: 1000
}

// Custom container — bring your own test runner
{
  image: "my-test-runner:latest",
  command: ["npm", "test"],
  env: { API_URL: "http://api:3000" },
  volumes: ["./tests:/tests:ro"],
}
```

### CleanupConfig

Controls whether environments are preserved or destroyed after a run.

```typescript
interface CleanupConfig {
  onPass?: "destroy" | "preserve"   // default: "destroy"
  onFail?: "destroy" | "preserve"   // default: "destroy"
}
```

## Storage Backends

### In-Memory (default)

```typescript
const platform = new TestPlatform()
// Uses MemoryStorage — data is lost on restart
```

### SQLite

```typescript
import { TestPlatform, SqliteStorage } from "@testplatform/core"

const platform = new TestPlatform({
  storage: new SqliteStorage("./data/runs.sqlite"),
})
```

### Custom Storage

Implement the `Storage` interface:

```typescript
import type { Storage, RunState, RunStatus } from "@testplatform/core"

class MyStorage implements Storage {
  async saveRun(state: RunState): Promise<void> { /* ... */ }
  async getRun(id: string): Promise<RunState | null> { /* ... */ }
  async listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]> { /* ... */ }
  async updateRun(id: string, patch: Partial<RunState>): Promise<void> { /* ... */ }
  async deleteRun(id: string): Promise<void> { /* ... */ }
}
```

## Events

The platform emits real-time events throughout a run's lifecycle:

| Event | Callback Signature | Description |
|---|---|---|
| `status` | `(runId, status) => void` | Run status changed |
| `log` | `(runId, line) => void` | New log line |
| `result` | `(runId, result) => void` | Test result received |
| `service:health` | `(runId, service, health) => void` | Service health changed |
| `finished` | `(runId, state) => void` | Run completed |

### Run Status Lifecycle

```
pending -> booting -> waiting_healthy -> testing -> passed/failed
                                                 -> error
                                     -> cancelled
```

## API Reference

### TestPlatform

| Method | Description |
|---|---|
| `createRun(config)` | Create and start a new test run |
| `createParallelRuns(config, count)` | Launch multiple identical runs |
| `getActiveRun(id)` | Get an in-progress run handle |
| `getActiveRunIds()` | List all active run IDs |
| `cancelRun(id)` | Cancel an active run |
| `destroyRun(id)` | Tear down a preserved environment |
| `getRun(id)` | Get run state (active or stored) |
| `listRuns(opts?)` | List runs with optional filters |
| `deleteRun(id)` | Delete a run from storage |
| `checkDocker()` | Check if Docker is available |
| `on(event, listener)` | Subscribe to platform events |
| `off(event, listener)` | Unsubscribe from events |

### Run

| Method | Description |
|---|---|
| `getState()` | Get a snapshot of the current run state |
| `cancel()` | Cancel the run and tear down containers |
| `destroy()` | Destroy a preserved environment |

## Project Structure

```
src/
  index.ts          # Public API exports
  types.ts          # All TypeScript interfaces and types
  platform.ts       # TestPlatform class — orchestration entry point
  run.ts            # Run class — full lifecycle management
  docker.ts         # Docker/Compose operations and helpers
  test-script.ts    # HTTP test script generator
  storage/
    memory.ts       # In-memory storage implementation
    sqlite.ts       # SQLite storage implementation (Bun)
```

## License

[MIT](LICENSE)
