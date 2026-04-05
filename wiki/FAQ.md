# FAQ

## General

### What runtime does this require?

[Bun](https://bun.sh) >= 1.3.11. The SqliteStorage backend uses Bun's native `bun:sqlite` module. The rest of the library uses standard Node.js APIs and should work with Node.js as well, but Bun is the primary target.

### Does it work on Windows?

Yes, as long as Docker Desktop is running. The library uses `docker compose` CLI commands which work across platforms.

### Can I use this in CI/CD?

Absolutely. Use `MemoryStorage` (default) and `cleanup: { onPass: "destroy", onFail: "destroy" }` for clean CI runs. See the [CI/CD example](../docs/examples.md#cicd-integration).

### How many parallel runs can I have?

Limited only by your machine's resources (CPU, RAM, disk). Each run starts a full Docker Compose stack, so plan accordingly. Start with 3-5 parallel runs and scale based on your hardware.

## Configuration

### How do services communicate with each other?

All services in a run share a Docker network. Use service names as hostnames:
```
http://api:3000     (service named "api", port 3000)
postgres://db:5432  (service named "db", port 5432)
```

### What's the difference between `infra` and `services`?

Semantically: `infra` is for dependencies (databases, caches), `services` is for your application code. Technically, they use the same `ServiceConfig` type. Infrastructure services are added to the Compose file first.

### Can I use private Docker registries?

Yes. Make sure you're logged in (`docker login <registry>`) before running tests. The platform uses `--pull always` which will use your Docker credentials.

### What if I don't define a healthcheck?

The service is considered ready as soon as the container starts (`condition: service_started` in Compose). This is fine for simple services but can cause race conditions if the service takes time to initialize.

## Testing

### Can I mix HTTP checks with custom tests?

Not in a single run. `TestConfig` is either `HttpCheckTest` or `CustomContainerTest`. For complex scenarios, use a custom container that does both.

### How do I access test results programmatically?

Subscribe to the `result` event or check `state.testResults` after the run finishes:

```typescript
const state = await platform.getRun(run.id)
console.log(state.testResults)
```

### Can the test runner access the host machine?

The test runner is inside Docker, so it can only access services within the Docker network. To access host resources, use Docker's host networking or volume mounts.

## Cleanup

### How do I clean up a preserved environment?

```typescript
await platform.destroyRun(run.id)
```

Or manually:
```bash
docker compose -p tp-<runId> down -v --remove-orphans
```

### What happens to orphaned containers if my process crashes?

They keep running. Use `docker compose ls` to find them and `docker compose -p <name> down -v` to clean up. Consider a cleanup script in your CI pipeline.

## Storage

### Can I use PostgreSQL/MySQL as a storage backend?

Not built-in, but you can implement the `Storage` interface for any database. See the [Storage documentation](../docs/storage.md) for examples.

### Is the Storage interface async-safe for concurrent writes?

`MemoryStorage` is safe for single-process use (JavaScript is single-threaded). `SqliteStorage` uses WAL mode for concurrent reads. For multi-process setups, use a proper database backend.
