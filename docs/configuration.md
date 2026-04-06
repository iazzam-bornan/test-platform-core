# Configuration Reference

Complete reference for all configuration types in `@testplatform/core`.

## RunConfig

The top-level configuration object passed to `platform.createRun()`.

```typescript
interface RunConfig {
  services: Record<string, ServiceConfig>  // Required: application services
  infra?: Record<string, ServiceConfig>    // Optional: infrastructure dependencies
  test: TestConfig                          // Required: test definition (HTTP, JMeter, Cucumber, or custom)
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

A union type — `HttpCheckTest`, `JmeterTest`, `CucumberTest`, or `CustomContainerTest`.

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

### JmeterTest

Declarative Apache JMeter load testing. The platform auto-generates a shell script, overrides the JMeter image entrypoint, and mounts the test plan.

```typescript
interface JmeterTest {
  jmeter: {
    testPlan: string                      // Path to .jmx file (required)
    image?: string                        // Docker image (default: "justb4/jmeter:latest")
    threads?: number                      // Concurrent threads (default: 10)
    rampUp?: number                       // Ramp-up period in seconds (default: 5)
    loops?: number                        // Loop count per thread (default: 3)
    duration?: number                     // Duration-based test in seconds (optional, overrides loops)
    errorThreshold?: number               // Max error rate percentage before failing (default: 10)
    properties?: Record<string, string>   // JMeter -J properties passed to the test plan
  }
}
```

**How it works:**
- The platform generates a wrapper script that invokes JMeter with your test plan and parameters
- The JMeter image entrypoint is overridden to execute the generated script
- Results are parsed from JMeter's JTL output and emitted as `@@RESULT@@` lines
- A summary with error rate, latency percentiles, and throughput is emitted at the end
- The run fails if the error rate exceeds `errorThreshold`

**Result fields:** `label`, `url`, `responseCode`, `responseMessage`, `threadName`, `bytes`, `sentBytes`, `connectTime`, `latency`

**Summary fields:** `errorRate`, `avgDuration`, `minDuration`, `maxDuration`, `p90Duration`, `p95Duration`

**Example:**
```typescript
{
  jmeter: {
    testPlan: "./tests/api-load.jmx",
    threads: 50,
    rampUp: 10,
    loops: 5,
    errorThreshold: 5,
    properties: {
      HOST: "api",
      PORT: "3000",
      PROTOCOL: "http",
    },
  },
}
```

---

### CucumberTest

Declarative BDD browser testing with Cucumber + Playwright. The platform runs a managed runner image that exposes a ready-to-use `CustomWorld` — users only supply feature files and step definitions.

```typescript
interface CucumberTest {
  cucumber: {
    features: string                              // Host path to the features directory (required)
    steps?: string                                // Host path to the step definitions directory
    image?: string                                // Docker image (default: "testplatform/cucumber-runner:latest")
    baseUrl?: string                              // Injected as BASE_URL env var; available as this.baseUrl
    browser?: "chromium" | "firefox" | "webkit"   // default: "chromium"
    headless?: boolean                            // default: true
    tags?: string                                 // Cucumber --tags expression (e.g. "@smoke and not @wip")
    env?: Record<string, string>                  // Additional environment variables
  }
}
```

**How it works:**
- The platform mounts your `features` and `steps` directories into the runner container
- The runner image ships a built-in `CustomWorld` class, `cucumber.js` config, `package.json`, and `ts-node` — you provide zero boilerplate
- Before each scenario, the World spins up a Playwright browser, context, page, and API request context
- Step definitions access these via `this.page`, `this.context`, `this.request`, and `this.baseUrl`
- On scenario failure, a screenshot is captured automatically and attached to the Cucumber result
- Results are streamed via `@@RESULT@@` lines with nested step details (keyword, text, status, duration, error)
- The run fails if any scenario fails

**Managed by the runner image:**
- `package.json`, `cucumber.js`, `tsconfig.json` — no need to ship them
- The `CustomWorld` class at `/runner/support/world` (importable as a type in TypeScript steps)
- Auto-screenshot on failure (attached as a PNG in the `attachments` field of the result)
- `ts-node` is pre-installed so you can write step definitions in `.ts`

**Writing step definitions** (TypeScript):

```typescript
import { Given, When, Then } from "@cucumber/cucumber"
import { expect } from "@playwright/test"
import type { CustomWorld } from "/runner/support/world"

Given("I visit the homepage", async function (this: CustomWorld) {
  await this.page.goto(this.baseUrl)
})

Then("I should see {string}", async function (this: CustomWorld, text: string) {
  await expect(this.page.getByText(text)).toBeVisible()
})
```

**Building the runner image:**

The runner image must be available on the Docker host before starting a run. Build it locally:

```bash
docker build -t testplatform/cucumber-runner:latest docker/cucumber-runner
```

Or pull it from your registry and override `image` in the config.

**Result fields:** `feature`, `scenario`, `tags`, `status`, `duration`, `error`, `steps` (array of `{ keyword, text, status, duration, error? }`), `attachments` (array of `{ mimeType, data }`).

**Summary fields:** `totalChecks`, `passed`, `failed`, `skipped`, `passRate`.

**Example:**
```typescript
{
  cucumber: {
    features: "./tests/features",
    steps: "./tests/steps",
    baseUrl: "http://web:80",
    browser: "chromium",
    headless: true,
    tags: "@smoke and not @wip",
    env: {
      API_URL: "http://api:3000",
    },
  },
}
```

---

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
