# Run Lifecycle

Every test run follows a predictable state machine from creation to completion.

## Status Flow

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │
                    ┌────▼─────┐
          ┌─────── │ booting  │ ───────┐
          │        └────┬─────┘        │
          │             │              │
          │   ┌─────────▼──────────┐   │
          │   │ waiting_healthy    │   │
          │   └─────────┬──────────┘   │
          │             │              │
          │        ┌────▼─────┐        │
          │        │ testing  │        │
          │        └──┬────┬──┘        │
          │           │    │           │
     ┌────▼───┐  ┌────▼┐ ┌▼─────┐    │
     │cancelled│  │passed│ │failed│    │
     └────────┘  └──────┘ └──────┘    │
                                  ┌───▼──┐
                                  │error │
                                  └──────┘
```

## States

### `pending`
Run has been created but execution hasn't started yet. This state is very brief.

### `booting`
The Docker Compose stack is being started:
1. Workspace directory created
2. Test script generated (if using httpChecks)
3. `docker-compose.yml` written
4. `docker compose up -d` executed
5. Container IDs collected

### `waiting_healthy`
All services are up, waiting for healthchecks to pass:
- Health is polled every 3 seconds
- `service:health` events emitted on changes
- Timeout: 5 minutes
- If any service becomes `unhealthy`, the run transitions to `error`

### `testing`
All services are healthy, the test runner is executing:
- Test runner container logs are streamed in real-time
- `@@RESULT@@` prefixed lines on stderr are parsed as test results
- `result` events emitted for each parsed result
- Waits for the test runner container to exit (timeout: 10 minutes)

### `passed`
Test runner exited with code 0. All tests passed.

### `failed`
Test runner exited with a non-zero code. Some tests failed.

### `cancelled`
Run was cancelled via `platform.cancelRun(id)` or `run.cancel()`. Containers are torn down immediately.

### `error`
An unexpected error occurred during any phase:
- Docker Compose failed to start
- A service healthcheck reported `unhealthy`
- Service health timeout exceeded
- Test runner never started
- Any unhandled exception

## Post-Run Behavior

After reaching a terminal state (`passed`, `failed`, `cancelled`, `error`):

1. **Service logs collected** — All container logs are captured into `state.serviceLogs`
2. **State persisted** — Final state saved to storage
3. **`finished` event emitted** — With the complete `RunState`
4. **Cleanup decision** — Based on `CleanupConfig`:

| Status | `onPass` | `onFail` | Action |
|---|---|---|---|
| `passed` | `"destroy"` | — | Tear down |
| `passed` | `"preserve"` | — | Keep running |
| `failed` | — | `"destroy"` | Tear down |
| `failed` | — | `"preserve"` | Keep running |
| `error` | — | `"destroy"` | Tear down |
| `error` | — | `"preserve"` | Keep running |
| `cancelled` | — | — | Already torn down |

## Timeouts

| Phase | Timeout | Description |
|---|---|---|
| `docker compose up` | 10 min | Stack startup |
| `waiting_healthy` | 5 min | All services healthy |
| Test runner start | 1 min | Container must appear |
| Test runner execution | 10 min | Container must exit |

## Cancellation

Cancellation is safe at any point:
- Sets `cancelled = true` flag
- Each lifecycle phase checks this flag
- Calls `docker compose down -v --remove-orphans`
- Cleans up workspace directory
- Emits `cancelled` status
