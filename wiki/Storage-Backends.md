# Storage Backends

The platform uses a pluggable storage layer for persisting run data. Choose a built-in backend or implement your own.

## Built-in Backends

### MemoryStorage (default)

```typescript
import { TestPlatform } from "@testplatform/core"
const platform = new TestPlatform()  // uses MemoryStorage
```

- Data stored in a `Map`
- Lost on process exit
- Zero configuration
- Best for: CI/CD, development, one-off runs

### SqliteStorage

```typescript
import { TestPlatform, SqliteStorage } from "@testplatform/core"

const platform = new TestPlatform({
  storage: new SqliteStorage("./data/runs.sqlite"),
})
```

- Persistent across restarts
- Uses Bun's native `bun:sqlite`
- WAL mode for concurrent reads
- Auto-creates DB file and directories
- Indexed on `status` and `started_at`
- Best for: production, dashboards, run history

## Custom Backends

Implement the `Storage` interface:

```typescript
interface Storage {
  saveRun(state: RunState): Promise<void>
  getRun(id: string): Promise<RunState | null>
  listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]>
  updateRun(id: string, patch: Partial<RunState>): Promise<void>
  deleteRun(id: string): Promise<void>
}
```

See the [Storage documentation](../docs/storage.md) for full PostgreSQL and Redis implementation examples.

## Querying

All queries go through the platform, which merges active runs with stored data:

```typescript
const run = await platform.getRun("run_123_abc")
const allRuns = await platform.listRuns()
const failed = await platform.listRuns({ status: "failed" })
const recent = await platform.listRuns({ limit: 10 })
```
