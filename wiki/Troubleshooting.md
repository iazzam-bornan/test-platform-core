# Troubleshooting

Common issues and how to resolve them.

## Docker Issues

### "Docker is not available"

**Cause**: Docker daemon isn't running or isn't accessible.

**Fix**:
```bash
# Check Docker
docker info

# Start Docker Desktop (macOS/Windows)
# Or start the daemon (Linux):
sudo systemctl start docker
```

### "Docker Compose up failed"

**Cause**: Image pull failure, port conflicts, or invalid config.

**Check the logs**:
```typescript
platform.on("log", (_, line) => console.log(line))
```

**Common fixes**:
- Verify the image exists: `docker pull <image>`
- Check for port conflicts: `docker ps` or `netstat -tlnp`
- Ensure Docker has enough resources (RAM/disk)

### Containers start but healthchecks fail

**Cause**: Service isn't ready within the healthcheck timeout.

**Fixes**:
- Increase `retries` and `interval` in the healthcheck config
- Check if the service actually starts correctly: `docker logs <container>`
- Verify the healthcheck command works inside the container

### Port conflicts between parallel runs

**Cause**: Multiple runs trying to bind the same host port.

**Fix**: Use internal-only ports (omit `host`) when running in parallel:
```typescript
ports: [{ container: 3000 }]  // No host mapping
```

## Run Issues

### Run stuck in "waiting_healthy"

**Cause**: One or more services never become healthy.

**Debug**:
```typescript
platform.on("service:health", (_, service, health) => {
  console.log(`${service}: ${health}`)
})
```

Check which service is stuck and inspect its logs:
```bash
docker compose -p tp-<runId> logs <service-name>
```

### Run stuck in "booting"

**Cause**: Docker Compose is slow to pull images or start containers.

**Fixes**:
- Pre-pull images: `docker pull <image>` before running tests
- Check network connectivity for image pulls
- Increase Docker's allocated resources

### Test runner never starts

**Cause**: Dependent services aren't healthy, so Compose won't start the test runner.

**Fix**: Resolve the unhealthy service first (see above).

### "Test runner container never started" error

**Cause**: The test runner container failed to appear within 60 seconds.

**Debug**:
```bash
docker compose -p tp-<runId> ps -a
docker compose -p tp-<runId> logs test-runner
```

## Storage Issues

### SQLite "database is locked"

**Cause**: Multiple processes writing to the same SQLite file.

**Fix**: SQLite storage uses WAL mode which supports concurrent reads but only one writer. Use a single platform instance per process, or switch to a client-server database for multi-process setups.

### Lost data with MemoryStorage

**Cause**: MemoryStorage only lives in process memory.

**Fix**: Use `SqliteStorage` for persistence across restarts.

## General Tips

1. **Always subscribe to events** during debugging:
   ```typescript
   platform.on("log", (_, line) => console.log(line))
   platform.on("status", (id, status) => console.log(`[${id}] ${status}`))
   ```

2. **Check Docker resources**: `docker system df` to see disk usage

3. **Clean up orphaned stacks**: `docker compose ls` to find running stacks, then `docker compose -p <name> down -v`

4. **Pre-pull images** in CI to avoid network-related timeouts
