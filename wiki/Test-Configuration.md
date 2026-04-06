# Test Configuration

Tests define what runs against your services after they're all healthy. There are four test modes: built-in HTTP checks, JMeter load tests, Cucumber + Playwright E2E tests, and custom container tests.

## HTTP Checks (Built-in)

The simplest way to test — point at URLs and the platform handles the rest.

```typescript
{
  test: {
    httpChecks: ["http://api:3000/health", "http://api:3000/api/status"],
    iterations: 10,   // default: 10
    delayMs: 1000,     // default: 1000ms
  },
}
```

### How It Works

1. The platform generates a Node.js test script
2. A `node:20-slim` container runs the script
3. For each iteration, every URL is fetched
4. Results are streamed via the `result` event
5. A summary is emitted at the end
6. Exit code: 0 if all passed, 1 if any failed

### URL Format

Use Docker Compose service names as hostnames:

```typescript
httpChecks: [
  "http://api:3000/health",       // service "api", port 3000
  "http://web:80/",               // service "web", port 80
  "http://gateway:8080/api/v1",   // service "gateway", port 8080
]
```

### Result Events

Each check emits a `result` event:

```typescript
// Individual check
{
  url: "http://api:3000/health",
  iteration: 1,
  status: 200,
  ok: true,
  duration: 45,           // ms
  timestamp: "2026-04-05T10:30:05.000Z",
  body: "{\"status\":\"ok\"}",  // first 200 chars
}

// Summary (emitted last)
{
  type: "summary",
  totalChecks: 20,
  passed: 19,
  failed: 1,
  passRate: 95,
  timestamp: "2026-04-05T10:30:30.000Z",
}
```

### Use Cases

- Smoke testing: verify endpoints are reachable
- Health monitoring: check service health after deployment
- Warm-up testing: hit endpoints multiple times to verify stability
- Regression: ensure known endpoints still respond correctly

## JMeter Load Tests

First-class Apache JMeter support. Declare your test plan and parameters — the platform generates the wrapper script, overrides the entrypoint, and mounts the `.jmx` file automatically.

```typescript
{
  test: {
    jmeter: {
      testPlan: "./tests/load-test.jmx",   // path to .jmx file
      threads: 20,                           // default: 10
      rampUp: 10,                            // default: 5s
      loops: 5,                              // default: 3
      errorThreshold: 5,                     // default: 10%
      properties: {                          // passed as -J flags
        HOST: "api",
        PORT: "3000",
      },
    },
  },
}
```

### How It Works

1. The platform generates a shell script with your JMeter parameters
2. The JMeter container (`justb4/jmeter:latest` by default) runs with its entrypoint overridden
3. The `.jmx` test plan is mounted into the container
4. Results are parsed from JMeter's JTL output and emitted as `@@RESULT@@` lines
5. A summary is emitted at the end with error rate and latency percentiles
6. The run fails if the error rate exceeds `errorThreshold`

### Parameters

| Field | Required | Default | Description |
|---|---|---|---|
| `testPlan` | Yes | — | Path to the `.jmx` test plan file |
| `image` | No | `justb4/jmeter:latest` | JMeter Docker image |
| `threads` | No | `10` | Number of concurrent threads |
| `rampUp` | No | `5` | Ramp-up period in seconds |
| `loops` | No | `3` | Loop count per thread |
| `duration` | No | — | Duration-based test in seconds (overrides `loops`) |
| `errorThreshold` | No | `10` | Maximum error rate (%) before the run fails |
| `properties` | No | — | Key-value pairs passed as JMeter `-J` properties |

### Result Events

Each JMeter sample emits a `result` event with:

```typescript
{
  label: "HTTP Request",
  url: "http://api:3000/endpoint",
  responseCode: "200",
  responseMessage: "OK",
  threadName: "Thread Group 1-1",
  bytes: 1234,
  sentBytes: 56,
  connectTime: 12,
  latency: 45,
}
```

### Summary

The summary includes aggregated metrics:

```typescript
{
  type: "summary",
  errorRate: 2.5,
  avgDuration: 120,
  minDuration: 15,
  maxDuration: 890,
  p90Duration: 250,
  p95Duration: 450,
}
```

### Use Cases

- Performance regression testing: catch latency regressions between builds
- Load testing: verify your service handles expected concurrency
- Stress testing: find breaking points with high thread counts
- External API testing: test third-party APIs without spinning up services

---

## Cucumber + Playwright Tests

First-class BDD browser testing. The platform uses a managed runner image (`testplatform/cucumber-runner:latest`) that bundles Playwright, Cucumber, and a pre-wired `CustomWorld`. You only provide feature files and step definitions — everything else (`package.json`, `cucumber.js`, the World class, `ts-node`) is handled by the image.

```typescript
{
  test: {
    cucumber: {
      features: "./tests/features",     // host path to .feature files
      steps: "./tests/steps",           // host path to step definitions
      baseUrl: "http://web:80",         // exposed as this.baseUrl
      browser: "chromium",              // default: "chromium"
      headless: true,                   // default: true
      tags: "@smoke and not @wip",      // Cucumber --tags filter
      env: {                            // additional env vars
        API_URL: "http://api:3000",
      },
    },
  },
}
```

### How It Works

1. The platform mounts your `features` and `steps` directories into the runner container
2. Before each scenario, the built-in World spins up a Playwright browser, context, page, and API request context
3. Step definitions access `this.page`, `this.context`, `this.request`, and `this.baseUrl`
4. On scenario failure, a screenshot is captured automatically and attached to the result
5. Results are streamed via `@@RESULT@@` lines with nested step details
6. The run fails if any scenario fails

### Parameters

| Field | Required | Default | Description |
|---|---|---|---|
| `features` | Yes | — | Host path to the features directory |
| `steps` | No | — | Host path to the step definitions directory |
| `image` | No | `testplatform/cucumber-runner:latest` | Runner Docker image |
| `baseUrl` | No | — | Injected as `BASE_URL`; exposed as `this.baseUrl` in steps |
| `browser` | No | `chromium` | One of `chromium`, `firefox`, `webkit` |
| `headless` | No | `true` | Whether to run browsers headless |
| `tags` | No | — | Cucumber `--tags` expression |
| `env` | No | — | Additional environment variables |

### Building the Runner Image

The runner image must be available on the Docker host before starting a run. Build it once:

```bash
docker build -t testplatform/cucumber-runner:latest docker/cucumber-runner
```

Or pull it from your registry and override `image` in the config.

### Writing Step Definitions

TypeScript is supported out of the box via pre-installed `ts-node`. Import `CustomWorld` as a type from `/runner/support/world` to get full intellisense:

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

You do **not** need to ship a `package.json`, `cucumber.js`, or a World class — the runner image provides all of these. Just drop your `.feature` and `.steps.ts` (or `.js`) files into the mounted directories.

### Result Events

Each scenario emits a `result` event:

```typescript
{
  feature: "Login",
  scenario: "User can log in with valid credentials",
  tags: ["@smoke"],
  status: "passed",
  duration: 1820,
  steps: [
    { keyword: "Given ", text: "I visit the homepage", status: "passed", duration: 340 },
    { keyword: "When ", text: 'I click "Sign in"', status: "passed", duration: 120 },
    { keyword: "Then ", text: 'I should see "Welcome back"', status: "passed", duration: 85 },
  ],
  attachments: [
    // Only present on failure — PNG screenshot of the page at the point of failure
    // { mimeType: "image/png", data: "<base64>" },
  ],
}
```

### Summary

```typescript
{
  type: "summary",
  totalChecks: 12,
  passed: 11,
  failed: 1,
  skipped: 0,
  passRate: 91.67,
}
```

### Use Cases

- End-to-end browser testing for web apps
- BDD-driven acceptance tests shared with non-engineers
- Smoke tests across full-stack environments (frontend + backend + infra)
- Regression suites that need to exercise real UI flows

---

## Custom Container Tests

For complex test logic, bring your own test image.

```typescript
{
  test: {
    image: "myorg/api-tests:latest",
    command: ["pytest", "-v", "/tests"],
    env: {
      API_URL: "http://api:3000",
      DB_URL: "postgres://test:test@postgres:5432/test",
    },
    volumes: ["./tests:/tests:ro"],
  },
}
```

### Parameters

| Field | Required | Description |
|---|---|---|
| `image` | Yes | Docker image for the test runner |
| `command` | Yes | Command to execute |
| `env` | No | Environment variables |
| `volumes` | No | Volume mounts |

### Exit Code

The test runner's exit code determines the run result:
- **0** = `passed`
- **Non-zero** = `failed`

### Examples

**pytest:**
```typescript
{
  image: "python:3.12-slim",
  command: ["pytest", "-v", "--tb=short"],
  volumes: ["./tests:/app/tests:ro", "./pytest.ini:/app/pytest.ini:ro"],
  env: { API_URL: "http://api:3000" },
}
```

**Jest:**
```typescript
{
  image: "node:20-slim",
  command: ["npx", "jest", "--forceExit"],
  volumes: ["./tests:/app/tests:ro", "./jest.config.js:/app/jest.config.js:ro"],
  env: { API_BASE: "http://api:3000" },
}
```

**k6 load test:**
```typescript
{
  image: "grafana/k6:latest",
  command: ["run", "/scripts/load-test.js"],
  volumes: ["./k6:/scripts:ro"],
  env: { K6_VUS: "50", K6_DURATION: "30s", BASE_URL: "http://api:3000" },
}
```

**curl-based:**
```typescript
{
  image: "curlimages/curl:latest",
  command: ["sh", "-c", "curl -sf http://api:3000/health && curl -sf http://api:3000/api/status"],
}
```

## Test Runner Container

Regardless of test type, the test runner container:
- Is named `test-runner` in the Compose stack
- Depends on **all** other services (infra + application)
- Waits for healthy dependencies before starting
- Has its stdout/stderr streamed as log events
- Its exit code determines the run's final status
