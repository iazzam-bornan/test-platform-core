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

Declarative BDD browser testing with Cucumber + Playwright. The platform runs a managed runner image that exposes a ready-to-use `CustomWorld`. Tests can be supplied in one of two modes: **local mode** (mount feature and step directories) or **repo mode** (clone a modular test repo at run time).

```typescript
interface CucumberTest {
  cucumber: {
    // Mode A: local files (mounted as volumes)
    features?: string                             // Host path to the features directory
    steps?: string                                // Host path to the step definitions directory

    // Mode B: clone from a git repo
    repo?: {
      url: string                                 // Git clone URL (https or ssh)
      ref?: string                                // Branch, tag, or SHA (default: "main")
      modules: string[]                           // Module names to load (e.g. ["auth", "checkout"])
      token?: string                              // Optional auth token for private repos
    }

    // Common
    image?: string                                // Docker image (default: "ghcr.io/iazzam-bornan/test-platform-cucumber-runner:latest")
    baseUrl?: string                              // Injected as BASE_URL env var; available as this.baseUrl
    browser?: "chromium" | "firefox" | "webkit"   // default: "chromium"
    headless?: boolean                            // default: true
    tags?: string                                 // Cucumber --tags expression (e.g. "@smoke and not @wip")
    env?: Record<string, string>                  // Additional environment variables
  }
}
```

Provide either `features` (local mode) **or** `repo` (repo mode) — not both.

#### Local Mode

**How it works:**
- The platform mounts your `features` and `steps` directories into the runner container
- The runner image ships a built-in `CustomWorld` class, `cucumber.js` config, `package.json`, and `ts-node` — you provide zero boilerplate
- Before each scenario, the World spins up a Playwright browser, context, page, and API request context
- Step definitions access these via `this.page`, `this.context`, `this.request`, and `this.baseUrl`
- On scenario failure, a screenshot is captured automatically and attached to the Cucumber result
- Results are streamed via `@@RESULT@@` lines with nested step details (keyword, text, status, duration, error)
- The run fails if any scenario fails

**Managed by the runner image (local mode):**
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

**Example (local mode):**
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

#### Repo Mode

Instead of mounting local files, the runner clones a git repository at run time and executes a subset of its modules. This is useful when the test suite lives in its own repository and you want to run only certain modules per environment.

**How it works:**
1. The platform sets the following env vars on the runner container: `GIT_REPO_URL`, `GIT_REPO_REF`, `MODULES`, `BASE_URL`, `BROWSER`, `HEADLESS`, optionally `TAGS` and `GIT_TOKEN`, plus any extra `env` keys from the config
2. The runner clones `GIT_REPO_URL` at `GIT_REPO_REF` into `/project`
3. If `package.json` exists, the runner runs `npm install`
4. The runner invokes `npx cucumber-js` from the repo root — the repo's own `cucumber.js` drives the execution
5. Results are parsed the same way as in local mode (from `RESULTS_FILE`, which the runner sets to `/results/cucumber.json`)

**Repo convention:** the cloned repo must follow this layout:

```
my-e2e-tests/
├── cucumber.js               # user-owned config that reads MODULES env var
├── package.json
├── tsconfig.json
└── modules/
    ├── shared/               # always loaded if it exists (by convention in cucumber.js)
    │   ├── pages/
    │   └── steps/
    ├── auth/
    │   ├── features/         # .feature files (REQUIRED — hard error if missing)
    │   ├── pages/            # page objects (.ts or .js, optional)
    │   └── steps/            # step definitions (.ts or .js, optional)
    └── checkout/
        ├── features/
        ├── pages/
        └── steps/
```

**Rules:**
- A module listed in `modules` that has no `features/` directory is a hard error
- `modules/shared/` is always loaded if it exists — this is a convention you implement in your own `cucumber.js`
- The user **owns** their `cucumber.js` — the platform does **not** generate it. Your `cucumber.js` should read the `MODULES` env var (comma- or space-separated) and build the feature/support paths dynamically. It should also honour `RESULTS_FILE` (set to `/results/cucumber.json` by the runner) so the platform can parse the output
- Sample repo to reference: <https://github.com/iazzam-bornan/taskboard-e2e-tests>

**Private repos:** pass an auth token via `repo.token` (TypeScript config) — it is forwarded as the `GIT_TOKEN` env var to the runner. In YAML configs, `repo.token` is plaintext — prefer using `env` to map from a host env var instead, or check the YAML into a secret store.

**Example (repo mode, TypeScript):**
```typescript
{
  cucumber: {
    repo: {
      url: "https://github.com/iazzam-bornan/taskboard-e2e-tests.git",
      ref: "main",
      modules: ["homepage", "api", "tasks"],
      token: process.env.GITHUB_TOKEN, // optional
    },
    baseUrl: "http://frontend:80",
    browser: "chromium",
    env: {
      BACKEND_URL: "http://backend:3000",
    },
  },
}
```

**Example (repo mode, YAML):**
```yaml
tests:
  runner:
    cucumber:
      repo:
        url: https://github.com/iazzam-bornan/taskboard-e2e-tests.git
        ref: main
        modules: [homepage, api, tasks]
      baseUrl: http://frontend:80
      env:
        BACKEND_URL: http://backend:3000
```

#### Runner Image

Both modes use the same managed runner image. The default is:

```
ghcr.io/iazzam-bornan/test-platform-cucumber-runner:latest
```

Pull it once on the Docker host (or let Docker pull on first run):

```bash
docker pull ghcr.io/iazzam-bornan/test-platform-cucumber-runner:latest
```

Override `image` in the config to use a fork or a pinned tag.

**Result fields:** `feature`, `scenario`, `tags`, `status`, `duration`, `error`, `steps` (array of `{ keyword, text, status, duration, error? }`), `attachments` (array of `{ mimeType, data }`).

**Summary fields:** `totalChecks`, `passed`, `failed`, `skipped`, `passRate`.

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
