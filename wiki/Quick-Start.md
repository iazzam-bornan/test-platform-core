# Quick Start

Get a test environment running in under 5 minutes.

## Step 1: Create a test file

Create `my-test.ts`:

```typescript
import { TestPlatform } from "@testplatform/core"

const platform = new TestPlatform()

// Verify Docker is running
if (!(await platform.checkDocker())) {
  console.error("Docker is not available. Please start Docker and try again.")
  process.exit(1)
}

// Log everything
platform.on("log", (_, line) => console.log(line))
platform.on("result", (_, result) => {
  if (result.type === "summary") {
    console.log(`\nResults: ${result.passed}/${result.totalChecks} passed (${result.passRate}%)`)
  }
})

// Start a test run
const run = await platform.createRun({
  services: {
    web: {
      image: "nginx:alpine",
      ports: [{ container: 80, host: 8080 }],
      healthcheck: {
        type: "http",
        path: "/",
        port: 80,
      },
    },
  },
  test: {
    httpChecks: ["http://web:80/"],
    iterations: 3,
    delayMs: 1000,
  },
})

console.log(`Run started: ${run.id}`)

// Wait for completion
await new Promise<void>((resolve) => {
  platform.on("finished", (id, state) => {
    if (id === run.id) {
      console.log(`\nFinal status: ${state.status}`)
      resolve()
    }
  })
})
```

## Step 2: Run it

```bash
bun run my-test.ts
```

## What Happens

1. The platform generates a `docker-compose.yml` with:
   - An `nginx:alpine` service with an HTTP healthcheck
   - A `node:20-slim` test runner that hits `http://web:80/` 3 times
2. `docker compose up -d` starts the stack
3. The platform polls until nginx reports healthy
4. The test runner executes and streams results
5. Everything is torn down automatically

## Step 3: Try Something More Complex

Add infrastructure dependencies:

```typescript
const run = await platform.createRun({
  infra: {
    postgres: {
      image: "postgres:16-alpine",
      env: {
        POSTGRES_DB: "test",
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
      },
      healthcheck: {
        type: "command",
        command: ["pg_isready", "-U", "test"],
      },
    },
  },
  services: {
    api: {
      image: "my-api:latest",
      env: {
        DATABASE_URL: "postgres://test:test@postgres:5432/test",
      },
      ports: [{ container: 3000, host: 3000 }],
      healthcheck: {
        type: "http",
        path: "/health",
        port: 3000,
      },
      dependsOn: ["postgres"],
    },
  },
  test: {
    httpChecks: [
      "http://api:3000/health",
      "http://api:3000/api/v1/status",
    ],
    iterations: 5,
  },
  cleanup: {
    onPass: "destroy",
    onFail: "preserve",  // Keep containers alive for debugging
  },
})
```

## Next Steps

- [Architecture Overview](Architecture-Overview) — Understand how the platform works
- [Service Configuration](Service-Configuration) — All service options
- [Healthchecks](Healthchecks) — HTTP, TCP, and command checks
- [Examples](Examples) — Real-world test configurations
