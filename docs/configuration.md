# Configuration Reference

Complete reference for all configuration types in `@testplatform/core`.

## RunConfig

The top-level configuration object passed to `platform.createRun()`.

```typescript
interface RunConfig {
  services: Record<string, ServiceConfig>  // Required: application services
  infra?: Record<string, ServiceConfig>    // Optional: infrastructure dependencies
  test: TestConfig                          // Required: test definition
  cleanup?: CleanupConfig                   // Optional: post-run behavior
}
```

### Key Concepts

- **services** — The application containers you're testing. These are the things your tests verify.
- **infra** — Supporting infrastructure (databases, caches, message queues). These boot first.
- **test** — What to run against your services once everything is healthy.
- **cleanup** — Whether to tear down or preserve the environment after the run.

---

## ServiceConfig

Defines a single Docker service.

```typescript
interface ServiceConfig {
  image: string                         // Docker image (required)
  env?: Record<string, string>          // Environment variables
  ports?: PortMapping[]                 // Port mappings
  healthcheck?: Healthcheck             // Health check configuration
  dependsOn?: string[]                  // Service dependencies (by name)
  volumes?: string[]                    // Volume mounts
}
```

### Examples

**Simple service:**
```typescript
{
  image: "nginx:alpine"
}
```

**Full configuration:**
```typescript
{
  image: "my-api:latest",
  env: {
    DATABASE_URL: "postgres://test:test@postgres:5432/testdb",
    REDIS_URL: "redis://redis:6379",
    NODE_ENV: "test",
  },
  ports: [
    { container: 3000, host: 3000 },
    { container: 9090 },              // internal only, no host mapping
  ],
  healthcheck: {
    type: "http",
    path: "/health",
    port: 3000,
    interval: 5,
    timeout: 10,
    retries: 5,
  },
  dependsOn: ["postgres", "redis"],
  volumes: ["./config:/app/config:ro"],
}
```

---

## PortMapping

Maps a container port to an optional host port.

```typescript
interface PortMapping {
  container: number   // Port inside the container (required)
  host?: number       // Port on the host machine (optional)
}
```

If `host` is omitted, the port is only accessible within the Docker network (other containers can reach it, but not the host machine).

---

## Healthcheck

Three types of healthchecks are supported. All share optional timing parameters:

| Parameter | Default | Description |
|---|---|---|
| `interval` | `5` | Seconds between checks |
| `timeout` | `10` | Seconds before a check times out |
| `retries` | `5` | Number of retries before marking unhealthy |

### HTTP Healthcheck

Checks that an HTTP endpoint returns a successful response.

```typescript
{
  type: "http",
  path: "/health",     // URL path to check
  port: 3000,          // Port to check on
  interval?: 5,
  timeout?: 10,
  retries?: 5,
}
```

The generated Docker healthcheck tries `wget`, `curl`, and Node.js `fetch` as fallbacks, so it works with any base image.

### Command Healthcheck

Runs a command inside the container. Exit code 0 = healthy.

```typescript
{
  type: "command",
  command: ["pg_isready", "-U", "postgres"],
  interval?: 5,
  timeout?: 10,
  retries?: 5,
}
```

### TCP Healthcheck

Checks that a TCP port is accepting connections.

```typescript
{
  type: "tcp",
  port: 6379,
  interval?: 5,
  timeout?: 10,
  retries?: 5,
}
```

Uses `nc` (netcat) under the hood.

---

## TestConfig

A union type — either `HttpCheckTest` or `CustomContainerTest`.

### HttpCheckTest

Built-in HTTP testing. The platform generates a Node.js test script and runs it in a `node:20-slim` container.

```typescript
interface HttpCheckTest {
  httpChecks: string[]    // URLs to test (use Docker service names as hostnames)
  iterations?: number     // How many times to test each URL (default: 10)
  delayMs?: number        // Delay between iterations in ms (default: 1000)
}
```

**How it works:**
- For each iteration, every URL is fetched
- Results are streamed in real-time via the `result` event
- A summary is emitted at the end with pass/fail counts
- Exit code 0 if all checks passed, 1 if any failed

**URL format:** Use Docker Compose service names as hostnames. For example, if your service is named `api`, use `http://api:3000/endpoint`.

### CustomContainerTest

Bring your own test container with arbitrary logic.

```typescript
interface CustomContainerTest {
  image: string                      // Docker image for the test runner
  command: string[]                  // Command to execute
  env?: Record<string, string>       // Environment variables
  volumes?: string[]                 // Volume mounts
}
```

**Example:**
```typescript
{
  image: "my-test-suite:latest",
  command: ["pytest", "-v", "/tests"],
  env: { API_URL: "http://api:3000" },
  volumes: ["./tests:/tests:ro"],
}
```

The test runner container's exit code determines pass/fail (0 = pass, non-zero = fail).

---

## CleanupConfig

Controls post-run environment behavior.

```typescript
interface CleanupConfig {
  onPass?: "destroy" | "preserve"   // default: "destroy"
  onFail?: "destroy" | "preserve"   // default: "destroy"
}
```

| Scenario | `"destroy"` | `"preserve"` |
|---|---|---|
| Tests pass | Containers removed, volumes cleaned | Containers kept running for inspection |
| Tests fail | Containers removed, volumes cleaned | Containers kept running for debugging |

**Preserve is useful for:**
- Debugging failed tests by inspecting container state
- Manually running additional queries against databases
- Checking application logs in real-time

To manually clean up a preserved environment:

```typescript
await platform.destroyRun(run.id)
```

---

## PlatformOptions

Passed to the `TestPlatform` constructor.

```typescript
interface PlatformOptions {
  workspaceDir?: string   // Directory for compose files (default: os.tmpdir())
  storage?: Storage       // Storage backend (default: MemoryStorage)
}
```

**Example:**
```typescript
import { TestPlatform, SqliteStorage } from "@testplatform/core"

const platform = new TestPlatform({
  workspaceDir: "./tmp/runs",
  storage: new SqliteStorage("./data/runs.sqlite"),
})
```
