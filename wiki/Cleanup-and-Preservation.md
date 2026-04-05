# Cleanup & Preservation

Control what happens to your Docker environment after a test run completes.

## CleanupConfig

```typescript
interface CleanupConfig {
  onPass?: "destroy" | "preserve"   // default: "destroy"
  onFail?: "destroy" | "preserve"   // default: "destroy"
}
```

## Behavior Matrix

| Status | `onPass` | `onFail` | Result |
|---|---|---|---|
| `passed` | `"destroy"` (default) | — | Containers removed |
| `passed` | `"preserve"` | — | Containers kept running |
| `failed` | — | `"destroy"` (default) | Containers removed |
| `failed` | — | `"preserve"` | Containers kept running |
| `error` | — | `"destroy"` | Containers removed |
| `error` | — | `"preserve"` | Containers kept running |
| `cancelled` | — | — | Always removed (cancel tears down immediately) |

## Common Configurations

### Always clean up (CI/CD)

```typescript
cleanup: { onPass: "destroy", onFail: "destroy" }
```

### Preserve on failure (debugging)

```typescript
cleanup: { onPass: "destroy", onFail: "preserve" }
```

### Always preserve (manual inspection)

```typescript
cleanup: { onPass: "preserve", onFail: "preserve" }
```

## Working with Preserved Environments

When an environment is preserved, the Docker Compose stack keeps running. You can:

```bash
# List running containers
docker compose -p tp-<runId> ps

# View logs
docker compose -p tp-<runId> logs -f

# Execute commands
docker compose -p tp-<runId> exec api sh

# Connect to a database
docker compose -p tp-<runId> exec postgres psql -U test testdb
```

## Manual Cleanup

Clean up a preserved environment programmatically:

```typescript
await platform.destroyRun(run.id)
```

Or via Docker directly:

```bash
docker compose -p tp-<runId> down -v --remove-orphans
```
