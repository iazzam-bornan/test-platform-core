# API Reference

Complete reference for all public classes, methods, and types.

## Classes

### TestPlatform

The main orchestrator. Creates and manages test runs.

```typescript
import { TestPlatform } from "@testplatform/core"
```

#### Constructor

```typescript
new TestPlatform(opts?: PlatformOptions)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `opts.workspaceDir` | `string` | `os.tmpdir()/testplatform-runs` | Directory for compose files |
| `opts.storage` | `Storage` | `MemoryStorage` | Storage backend |

#### Methods

##### `createRun(config: RunConfig): Promise<Run>`

Creates and starts a new test run. The run executes in the background.

```typescript
const run = await platform.createRun({
  services: { /* ... */ },
  test: { httpChecks: ["http://web:80/"] },
})
console.log(run.id) // "run_1712300000000_a1b2c3"
```

##### `createParallelRuns(config: RunConfig, count: number): Promise<Run[]>`

Creates multiple identical runs in parallel.

```typescript
const runs = await platform.createParallelRuns(config, 5)
// 5 independent runs, each with their own Docker stack
```

##### `getActiveRun(id: string): Run | undefined`

Returns the `Run` handle for an in-progress run. Returns `undefined` if the run has finished.

##### `getActiveRunIds(): string[]`

Returns IDs of all currently active (in-progress) runs.

##### `cancelRun(id: string): Promise<void>`

Cancels an active run. Stops polling, tears down containers, sets status to `"cancelled"`.

##### `destroyRun(id: string): Promise<void>`

Tears down a preserved environment (from a run with `cleanup.onFail: "preserve"`).

##### `getRun(id: string): Promise<RunState | null>`

Gets run state. For active runs, returns the live state. For finished runs, reads from storage.

##### `listRuns(opts?): Promise<RunState[]>`

Lists runs, merging active and stored runs.

| Option | Type | Description |
|---|---|---|
| `status` | `RunStatus` | Filter by status |
| `limit` | `number` | Maximum results |

##### `deleteRun(id: string): Promise<void>`

Deletes a run from storage.

##### `checkDocker(): Promise<boolean>`

Returns `true` if Docker is available and responsive.

##### `on<E>(event: E, listener: PlatformEvents[E]): this`

Subscribe to a platform event. See [Events](./events.md).

##### `off<E>(event: E, listener: PlatformEvents[E]): this`

Unsubscribe from a platform event.

---

### Run

Represents a single test run. Returned by `platform.createRun()`.

```typescript
const run = await platform.createRun(config)
```

#### Properties

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique run identifier |

#### Methods

##### `getState(): RunState`

Returns a snapshot of the current run state.

```typescript
const state = run.getState()
console.log(state.status)     // "testing"
console.log(state.services)   // ServiceState[]
console.log(state.logs)       // string[]
```

##### `cancel(): Promise<void>`

Cancels the run and tears down all containers.

##### `destroy(): Promise<void>`

Destroys a preserved environment.

---

### MemoryStorage

In-memory storage implementation.

```typescript
import { MemoryStorage } from "@testplatform/core"
const storage = new MemoryStorage()
```

All data lives in a `Map` and is lost when the process exits.

---

### SqliteStorage

SQLite-based persistent storage.

```typescript
import { SqliteStorage } from "@testplatform/core"
const storage = new SqliteStorage("./data/runs.sqlite")
```

#### Constructor

```typescript
new SqliteStorage(dbPath: string)
```

Creates the database file and parent directories if they don't exist. Runs migrations automatically.

---

## Types

### RunConfig

```typescript
interface RunConfig {
  services: Record<string, ServiceConfig>
  infra?: Record<string, ServiceConfig>
  test: TestConfig
  cleanup?: CleanupConfig
}
```

### ServiceConfig

```typescript
interface ServiceConfig {
  image: string
  env?: Record<string, string>
  ports?: PortMapping[]
  healthcheck?: Healthcheck
  dependsOn?: string[]
  volumes?: string[]
}
```

### PortMapping

```typescript
interface PortMapping {
  container: number
  host?: number
}
```

### Healthcheck

```typescript
type Healthcheck =
  | { type: "http"; path: string; port: number; interval?: number; timeout?: number; retries?: number }
  | { type: "command"; command: string[]; interval?: number; timeout?: number; retries?: number }
  | { type: "tcp"; port: number; interval?: number; timeout?: number; retries?: number }
```

### TestConfig

```typescript
type TestConfig = HttpCheckTest | CustomContainerTest
```

### HttpCheckTest

```typescript
interface HttpCheckTest {
  httpChecks: string[]
  iterations?: number   // default: 10
  delayMs?: number      // default: 1000
}
```

### CustomContainerTest

```typescript
interface CustomContainerTest {
  image: string
  command: string[]
  env?: Record<string, string>
  volumes?: string[]
}
```

### CleanupConfig

```typescript
interface CleanupConfig {
  onPass?: "destroy" | "preserve"   // default: "destroy"
  onFail?: "destroy" | "preserve"   // default: "destroy"
}
```

### RunState

The complete state of a run at a point in time.

```typescript
interface RunState {
  id: string
  status: RunStatus
  config: RunConfig
  services: ServiceState[]
  startedAt: string
  finishedAt?: string
  exitCode?: number
  error?: string
  logs: string[]
  testResults: TestResult[]
  serviceLogs: Record<string, string>
}
```

### RunStatus

```typescript
type RunStatus =
  | "pending"
  | "booting"
  | "waiting_healthy"
  | "testing"
  | "passed"
  | "failed"
  | "cancelled"
  | "error"
  | "cleaning_up"
```

### ServiceState

```typescript
interface ServiceState {
  name: string
  image: string
  containerId?: string
  health: ServiceHealth
  ports: Record<number, number>
}
```

### ServiceHealth

```typescript
type ServiceHealth = "unknown" | "starting" | "healthy" | "unhealthy"
```

### TestResult

```typescript
interface TestResult {
  url?: string
  iteration?: number
  status?: number
  ok?: boolean
  duration?: number
  timestamp?: string
  error?: string
  body?: string
  type?: "summary"
  totalChecks?: number
  passed?: number
  failed?: number
  passRate?: number
}
```

### PlatformEvents

```typescript
interface PlatformEvents {
  "status": (runId: string, status: RunStatus) => void
  "log": (runId: string, line: string) => void
  "result": (runId: string, result: TestResult) => void
  "service:health": (runId: string, service: string, health: ServiceHealth) => void
  "finished": (runId: string, state: RunState) => void
}
```

### Storage

```typescript
interface Storage {
  saveRun(state: RunState): Promise<void>
  getRun(id: string): Promise<RunState | null>
  listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]>
  updateRun(id: string, patch: Partial<RunState>): Promise<void>
  deleteRun(id: string): Promise<void>
}
```

### PlatformOptions

```typescript
interface PlatformOptions {
  workspaceDir?: string
  storage?: Storage
}
```

## Docker Module Exports

Low-level Docker utilities exported from `@testplatform/core/docker`:

```typescript
import {
  generateComposeFile,
  isDockerAvailable,
  composeUp,
  composeDown,
  getContainerIds,
  getContainerHealth,
  isContainerRunning,
  getContainerExitCode,
  getContainerLogs,
  streamContainerLogs,
  writeFile,
} from "@testplatform/core/docker"
```

These are used internally by the platform but are exported for advanced use cases.
