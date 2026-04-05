# Events & Real-time Monitoring

The platform emits events throughout a run's lifecycle for real-time monitoring.

## Subscribing

```typescript
platform.on("status", (runId, status) => { /* ... */ })
platform.on("log", (runId, line) => { /* ... */ })
platform.on("result", (runId, result) => { /* ... */ })
platform.on("service:health", (runId, service, health) => { /* ... */ })
platform.on("finished", (runId, state) => { /* ... */ })
```

## Event Reference

| Event | Signature | When |
|---|---|---|
| `status` | `(runId, RunStatus)` | Run status changes |
| `log` | `(runId, string)` | New log line (timestamped) |
| `result` | `(runId, TestResult)` | Test result or summary |
| `service:health` | `(runId, service, ServiceHealth)` | Service health changes |
| `finished` | `(runId, RunState)` | Run reaches terminal state |

## Patterns

### SSE Streaming

```typescript
// Stream run events as Server-Sent Events
app.get("/runs/:id/stream", (c) => {
  return new Response(new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

      platform.on("log", (id, line) => { if (id === runId) send("log", { line }) })
      platform.on("finished", (id, state) => {
        if (id === runId) { send("finished", state); controller.close() }
      })
    }
  }), { headers: { "Content-Type": "text/event-stream" } })
})
```

### Wait for Completion

```typescript
const state = await new Promise<RunState>((resolve) => {
  platform.on("finished", (id, state) => {
    if (id === run.id) resolve(state)
  })
})
```

See the [Events documentation](../docs/events.md) for more patterns including dashboard backends and parallel run aggregation.
