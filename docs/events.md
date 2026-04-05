# Events & Monitoring

`@testplatform/core` provides a real-time event system for monitoring runs as they execute.

## Event System

The `TestPlatform` instance is an event emitter. Subscribe with `.on()` and unsubscribe with `.off()`.

```typescript
const platform = new TestPlatform()

// Subscribe
platform.on("status", handler)

// Unsubscribe
platform.off("status", handler)
```

## Events Reference

### `status`

Emitted when a run's status changes.

```typescript
platform.on("status", (runId: string, status: RunStatus) => {
  console.log(`Run ${runId} is now: ${status}`)
})
```

**RunStatus values:**

| Status | Description |
|---|---|
| `pending` | Run created, not yet started |
| `booting` | Docker Compose stack starting |
| `waiting_healthy` | Waiting for service healthchecks |
| `testing` | Test runner executing |
| `passed` | All tests passed (exit code 0) |
| `failed` | Tests failed (non-zero exit code) |
| `cancelled` | Run was cancelled by user |
| `error` | Unexpected error occurred |
| `cleaning_up` | Environment being torn down |

**Lifecycle flow:**

```
pending -> booting -> waiting_healthy -> testing -> passed
                                                 -> failed
                                      -> error (at any stage)
                                      -> cancelled (at any stage)
```

### `log`

Emitted for each log line produced during a run.

```typescript
platform.on("log", (runId: string, line: string) => {
  // line is prefixed with ISO timestamp
  // e.g., "[2026-04-05T10:30:00.000Z] Docker Compose stack started."
  console.log(line)
})
```

Log sources include:
- Platform lifecycle messages
- Docker Compose output (prefixed with `[docker]`)
- Test runner output (prefixed with `[test]`)

### `result`

Emitted for each test result, including the final summary.

```typescript
platform.on("result", (runId: string, result: TestResult) => {
  if (result.type === "summary") {
    console.log(`${result.passed}/${result.totalChecks} passed (${result.passRate}%)`)
  } else {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.url} - ${result.status} (${result.duration}ms)`)
  }
})
```

**TestResult for individual checks:**

```typescript
{
  url: "http://api:3000/health",
  iteration: 1,
  status: 200,
  ok: true,
  duration: 45,
  timestamp: "2026-04-05T10:30:05.000Z",
  body: "{\"status\":\"ok\"}",
}
```

**TestResult for failures:**

```typescript
{
  url: "http://api:3000/health",
  iteration: 3,
  status: 0,
  ok: false,
  duration: 5000,
  timestamp: "2026-04-05T10:30:15.000Z",
  error: "fetch failed",
}
```

**TestResult summary (emitted last):**

```typescript
{
  type: "summary",
  totalChecks: 30,
  passed: 28,
  failed: 2,
  passRate: 93,
  timestamp: "2026-04-05T10:31:00.000Z",
}
```

### `service:health`

Emitted when a service's health status changes.

```typescript
platform.on("service:health", (runId: string, service: string, health: ServiceHealth) => {
  console.log(`${service}: ${health}`)
})
```

**ServiceHealth values:** `"unknown"` | `"starting"` | `"healthy"` | `"unhealthy"`

### `finished`

Emitted once when a run reaches a terminal state. Contains the complete final state.

```typescript
platform.on("finished", (runId: string, state: RunState) => {
  console.log(`Run ${runId} finished: ${state.status}`)
  console.log(`Duration: ${Date.now() - new Date(state.startedAt).getTime()}ms`)
  console.log(`Test results: ${state.testResults.length}`)
  console.log(`Services: ${state.services.map(s => `${s.name}(${s.health})`).join(", ")}`)
})
```

## Patterns

### Building a Dashboard Backend

```typescript
import { TestPlatform, SqliteStorage } from "@testplatform/core"
import { Hono } from "hono"

const platform = new TestPlatform({
  storage: new SqliteStorage("./data/runs.sqlite"),
})

const app = new Hono()

// SSE endpoint for real-time updates
app.get("/runs/:id/stream", (c) => {
  const runId = c.req.param("id")

  return new Response(
    new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }

        const onStatus = (id: string, status: string) => {
          if (id === runId) send("status", { status })
        }
        const onLog = (id: string, line: string) => {
          if (id === runId) send("log", { line })
        }
        const onResult = (id: string, result: unknown) => {
          if (id === runId) send("result", result)
        }
        const onFinished = (id: string, state: unknown) => {
          if (id === runId) {
            send("finished", state)
            cleanup()
            controller.close()
          }
        }

        platform.on("status", onStatus)
        platform.on("log", onLog)
        platform.on("result", onResult)
        platform.on("finished", onFinished)

        const cleanup = () => {
          platform.off("status", onStatus)
          platform.off("log", onLog)
          platform.off("result", onResult)
          platform.off("finished", onFinished)
        }
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  )
})
```

### Waiting for a Run to Complete

```typescript
function waitForRun(platform: TestPlatform, runId: string): Promise<RunState> {
  return new Promise((resolve) => {
    platform.on("finished", (id, state) => {
      if (id === runId) resolve(state)
    })
  })
}

const run = await platform.createRun(config)
const finalState = await waitForRun(platform, run.id)
console.log(`Final status: ${finalState.status}`)
```

### Aggregating Results Across Parallel Runs

```typescript
const runs = await platform.createParallelRuns(config, 3)
const results: RunState[] = []

await Promise.all(
  runs.map(
    (run) =>
      new Promise<void>((resolve) => {
        platform.on("finished", (id, state) => {
          if (id === run.id) {
            results.push(state)
            resolve()
          }
        })
      })
  )
)

const passCount = results.filter((r) => r.status === "passed").length
console.log(`${passCount}/${results.length} runs passed`)
```
