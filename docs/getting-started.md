# Getting Started

This guide walks you through installing `@testplatform/core` and running your first test environment.

## Prerequisites

| Requirement | Version |
|---|---|
| [Bun](https://bun.sh) | >= 1.3.11 |
| [Docker](https://docs.docker.com/get-docker/) | Latest stable |
| Docker Compose | v2 (bundled with Docker Desktop) |

Verify your setup:

```bash
bun --version    # 1.3.11+
docker info      # Should print Docker Engine info
docker compose version  # Docker Compose version v2.x.x
```

## Installation

```bash
bun add @testplatform/core
```

## Your First Test Run

### 1. Create a platform instance

```typescript
import { TestPlatform } from "@testplatform/core"

const platform = new TestPlatform()
```

### 2. Verify Docker is available

```typescript
const dockerOk = await platform.checkDocker()
if (!dockerOk) {
  console.error("Docker is not running!")
  process.exit(1)
}
```

### 3. Define your test configuration

```typescript
const config = {
  // Infrastructure your app needs
  infra: {
    redis: {
      image: "redis:7-alpine",
      ports: [{ container: 6379, host: 6379 }],
      healthcheck: {
        type: "tcp" as const,
        port: 6379,
      },
    },
  },

  // Your application services
  services: {
    web: {
      image: "nginx:alpine",
      ports: [{ container: 80, host: 8080 }],
      healthcheck: {
        type: "http" as const,
        path: "/",
        port: 80,
      },
    },
  },

  // What to test
  test: {
    httpChecks: ["http://web:80/"],
    iterations: 3,
    delayMs: 1000,
  },
}
```

### 4. Subscribe to events and start the run

```typescript
platform.on("status", (runId, status) => {
  console.log(`[${runId}] ${status}`)
})

platform.on("log", (_runId, line) => {
  console.log(line)
})

platform.on("result", (_runId, result) => {
  if (result.type === "summary") {
    console.log(`\nResults: ${result.passed}/${result.totalChecks} passed (${result.passRate}%)`)
  }
})

platform.on("finished", (_runId, state) => {
  console.log(`\nRun finished with status: ${state.status}`)
  process.exit(state.status === "passed" ? 0 : 1)
})

const run = await platform.createRun(config)
console.log(`Started run: ${run.id}`)
```

### 5. Run it

Save the above as `test.ts` and run:

```bash
bun run test.ts
```

You should see:
1. Docker Compose stack starting
2. Health checks running
3. HTTP test iterations executing
4. Final pass/fail result

## What Happens Under the Hood

1. **Config validation** — Your `RunConfig` is parsed and validated
2. **Compose generation** — A `docker-compose.yml` is generated in a temp directory
3. **Stack boot** — `docker compose up -d` starts all services
4. **Health polling** — The platform polls container health until all services are healthy (or timeout)
5. **Test execution** — A test runner container starts, executes tests, and streams results
6. **Result collection** — Test results and service logs are collected
7. **Cleanup** — Based on your `CleanupConfig`, the environment is either destroyed or preserved

## Next Steps

- [Configuration Reference](./configuration.md) — All config options in detail
- [Storage Backends](./storage.md) — Persisting run data
- [Events & Monitoring](./events.md) — Real-time event system
- [API Reference](./api-reference.md) — Complete class and method docs
