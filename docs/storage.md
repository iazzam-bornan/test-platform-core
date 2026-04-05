# Storage Backends

`@testplatform/core` uses a pluggable storage system for persisting run data. You can use the built-in backends or implement your own.

## Storage Interface

All storage backends implement this interface:

```typescript
interface Storage {
  saveRun(state: RunState): Promise<void>
  getRun(id: string): Promise<RunState | null>
  listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]>
  updateRun(id: string, patch: Partial<RunState>): Promise<void>
  deleteRun(id: string): Promise<void>
}
```

## Built-in Backends

### MemoryStorage

In-memory storage using a `Map`. This is the default — no configuration needed.

```typescript
import { TestPlatform } from "@testplatform/core"

const platform = new TestPlatform()
// Equivalent to:
// const platform = new TestPlatform({ storage: new MemoryStorage() })
```

**Characteristics:**
- Zero setup
- Fast reads and writes
- Data is lost when the process exits
- Good for: development, CI/CD pipelines, one-off test runs

### SqliteStorage

SQLite-based persistent storage using Bun's built-in SQLite driver.

```typescript
import { TestPlatform, SqliteStorage } from "@testplatform/core"

const storage = new SqliteStorage("./data/runs.sqlite")
const platform = new TestPlatform({ storage })
```

**Characteristics:**
- Data persists across restarts
- Uses WAL mode for concurrent reads
- Auto-creates the database file and directory
- Indexed on `status` and `started_at` for fast queries
- Good for: production, dashboard backends, run history

**Database schema:**

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,       -- JSON-serialized RunState
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_started ON runs(started_at);
```

## Custom Storage Backend

Implement the `Storage` interface for any data store:

### PostgreSQL Example

```typescript
import type { Storage, RunState, RunStatus } from "@testplatform/core"
import { Pool } from "pg"

export class PostgresStorage implements Storage {
  private pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString })
  }

  async saveRun(state: RunState): Promise<void> {
    await this.pool.query(
      `INSERT INTO runs (id, state, status, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         state = EXCLUDED.state,
         status = EXCLUDED.status,
         finished_at = EXCLUDED.finished_at`,
      [state.id, JSON.stringify(state), state.status, state.startedAt, state.finishedAt]
    )
  }

  async getRun(id: string): Promise<RunState | null> {
    const result = await this.pool.query("SELECT state FROM runs WHERE id = $1", [id])
    if (result.rows.length === 0) return null
    return JSON.parse(result.rows[0].state)
  }

  async listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]> {
    let query = "SELECT state FROM runs"
    const params: unknown[] = []

    if (opts?.status) {
      query += " WHERE status = $1"
      params.push(opts.status)
    }

    query += " ORDER BY started_at DESC"

    if (opts?.limit) {
      query += ` LIMIT $${params.length + 1}`
      params.push(opts.limit)
    }

    const result = await this.pool.query(query, params)
    return result.rows.map((r) => JSON.parse(r.state))
  }

  async updateRun(id: string, patch: Partial<RunState>): Promise<void> {
    const existing = await this.getRun(id)
    if (!existing) return
    await this.saveRun({ ...existing, ...patch })
  }

  async deleteRun(id: string): Promise<void> {
    await this.pool.query("DELETE FROM runs WHERE id = $1", [id])
  }
}
```

### Redis Example

```typescript
import type { Storage, RunState, RunStatus } from "@testplatform/core"
import { createClient } from "redis"

export class RedisStorage implements Storage {
  private client: ReturnType<typeof createClient>

  constructor(url: string) {
    this.client = createClient({ url })
    this.client.connect()
  }

  async saveRun(state: RunState): Promise<void> {
    await this.client.set(`run:${state.id}`, JSON.stringify(state))
    await this.client.zAdd("runs:by-time", {
      score: new Date(state.startedAt).getTime(),
      value: state.id,
    })
  }

  async getRun(id: string): Promise<RunState | null> {
    const data = await this.client.get(`run:${id}`)
    return data ? JSON.parse(data) : null
  }

  async listRuns(opts?: { status?: RunStatus; limit?: number }): Promise<RunState[]> {
    const ids = await this.client.zRange("runs:by-time", 0, -1, { REV: true })
    const limited = opts?.limit ? ids.slice(0, opts.limit) : ids

    const runs: RunState[] = []
    for (const id of limited) {
      const run = await this.getRun(id)
      if (run && (!opts?.status || run.status === opts.status)) {
        runs.push(run)
      }
    }
    return runs
  }

  async updateRun(id: string, patch: Partial<RunState>): Promise<void> {
    const existing = await this.getRun(id)
    if (!existing) return
    await this.saveRun({ ...existing, ...patch })
  }

  async deleteRun(id: string): Promise<void> {
    await this.client.del(`run:${id}`)
    await this.client.zRem("runs:by-time", id)
  }
}
```

## Querying Runs

Regardless of the storage backend, you query runs through the platform:

```typescript
// Get a specific run
const run = await platform.getRun("run_123456_abc")

// List all runs
const allRuns = await platform.listRuns()

// Filter by status
const failed = await platform.listRuns({ status: "failed" })

// Limit results
const recent = await platform.listRuns({ limit: 10 })

// Combine filters
const recentFailed = await platform.listRuns({ status: "failed", limit: 5 })
```

Note: `platform.getRun()` and `platform.listRuns()` automatically merge active (in-progress) runs with stored runs, so you always get the freshest state.
