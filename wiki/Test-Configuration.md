# Test Configuration

Tests define what runs against your services after they're all healthy. There are two test modes: built-in HTTP checks and custom container tests.

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
