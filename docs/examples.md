# Examples

Real-world examples of using `@testplatform/core` for different testing scenarios.

## Testing a REST API with PostgreSQL

```typescript
import { TestPlatform } from "@testplatform/core"

const platform = new TestPlatform()

const run = await platform.createRun({
  infra: {
    postgres: {
      image: "postgres:16-alpine",
      env: {
        POSTGRES_DB: "myapp_test",
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
      },
      ports: [{ container: 5432 }],
      healthcheck: {
        type: "command",
        command: ["pg_isready", "-U", "test"],
        interval: 3,
        retries: 10,
      },
    },
  },
  services: {
    api: {
      image: "myorg/api:latest",
      env: {
        DATABASE_URL: "postgres://test:test@postgres:5432/myapp_test",
        NODE_ENV: "test",
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
    iterations: 10,
    delayMs: 500,
  },
  cleanup: {
    onPass: "destroy",
    onFail: "preserve",
  },
})
```

## Testing a Microservices Architecture

```typescript
const run = await platform.createRun({
  infra: {
    redis: {
      image: "redis:7-alpine",
      ports: [{ container: 6379 }],
      healthcheck: { type: "tcp", port: 6379 },
    },
    rabbitmq: {
      image: "rabbitmq:3-management-alpine",
      ports: [
        { container: 5672 },
        { container: 15672, host: 15672 },
      ],
      healthcheck: {
        type: "command",
        command: ["rabbitmq-diagnostics", "check_running"],
        interval: 10,
        timeout: 15,
        retries: 10,
      },
    },
  },
  services: {
    gateway: {
      image: "myorg/gateway:latest",
      env: {
        AUTH_SERVICE_URL: "http://auth:4000",
        ORDER_SERVICE_URL: "http://orders:4001",
        REDIS_URL: "redis://redis:6379",
      },
      ports: [{ container: 3000, host: 3000 }],
      healthcheck: { type: "http", path: "/health", port: 3000 },
      dependsOn: ["redis", "auth", "orders"],
    },
    auth: {
      image: "myorg/auth-service:latest",
      env: {
        REDIS_URL: "redis://redis:6379",
        JWT_SECRET: "test-secret",
      },
      ports: [{ container: 4000 }],
      healthcheck: { type: "http", path: "/health", port: 4000 },
      dependsOn: ["redis"],
    },
    orders: {
      image: "myorg/order-service:latest",
      env: {
        RABBITMQ_URL: "amqp://rabbitmq:5672",
        REDIS_URL: "redis://redis:6379",
      },
      ports: [{ container: 4001 }],
      healthcheck: { type: "http", path: "/health", port: 4001 },
      dependsOn: ["redis", "rabbitmq"],
    },
  },
  test: {
    httpChecks: [
      "http://gateway:3000/health",
      "http://gateway:3000/api/auth/status",
      "http://gateway:3000/api/orders/status",
    ],
    iterations: 5,
    delayMs: 2000,
  },
})
```

## Custom Test Runner (pytest)

```typescript
const run = await platform.createRun({
  infra: {
    postgres: {
      image: "postgres:16-alpine",
      env: { POSTGRES_DB: "test", POSTGRES_USER: "test", POSTGRES_PASSWORD: "test" },
      healthcheck: { type: "command", command: ["pg_isready", "-U", "test"] },
    },
  },
  services: {
    api: {
      image: "myorg/api:latest",
      env: { DATABASE_URL: "postgres://test:test@postgres:5432/test" },
      ports: [{ container: 8000 }],
      healthcheck: { type: "http", path: "/docs", port: 8000 },
      dependsOn: ["postgres"],
    },
  },
  test: {
    image: "myorg/api-tests:latest",
    command: ["pytest", "-v", "--tb=short", "/tests"],
    env: {
      API_URL: "http://api:8000",
      DB_URL: "postgres://test:test@postgres:5432/test",
    },
  },
})
```

## Load Testing with k6

```typescript
const run = await platform.createRun({
  services: {
    web: {
      image: "myorg/web:latest",
      ports: [{ container: 3000, host: 3000 }],
      healthcheck: { type: "http", path: "/", port: 3000 },
    },
  },
  test: {
    image: "grafana/k6:latest",
    command: ["run", "/scripts/load-test.js"],
    volumes: ["./k6-scripts:/scripts:ro"],
    env: {
      K6_VUS: "50",
      K6_DURATION: "30s",
      BASE_URL: "http://web:3000",
    },
  },
  cleanup: {
    onPass: "destroy",
    onFail: "preserve",
  },
})
```

## Load Testing with JMeter

```typescript
const run = await platform.createRun({
  services: {
    api: {
      image: "myorg/api:latest",
      ports: [{ container: 3000, host: 3000 }],
      healthcheck: { type: "http", path: "/health", port: 3000 },
    },
  },
  test: {
    jmeter: {
      testPlan: "./jmeter/api-load-test.jmx",
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
  },
  cleanup: {
    onPass: "destroy",
    onFail: "preserve",
  },
})
```

## JMeter Load Test Against an External API (No Services)

No `services` or `infra` needed — just point JMeter at an external target:

```typescript
const run = await platform.createRun({
  services: {},
  test: {
    jmeter: {
      testPlan: "./jmeter/external-api.jmx",
      threads: 100,
      rampUp: 30,
      duration: 120,
      errorThreshold: 2,
      image: "justb4/jmeter:latest",
      properties: {
        HOST: "api.example.com",
        PORT: "443",
        PROTOCOL: "https",
      },
    },
  },
})
```

## Parallel Runs for Flakiness Detection

```typescript
const platform = new TestPlatform()

// Run the same config 5 times in parallel
const runs = await platform.createParallelRuns(config, 5)

// Wait for all to finish
const results = await Promise.all(
  runs.map(
    (run) =>
      new Promise<RunState>((resolve) => {
        platform.on("finished", (id, state) => {
          if (id === run.id) resolve(state)
        })
      })
  )
)

const passed = results.filter((r) => r.status === "passed").length
const failed = results.filter((r) => r.status === "failed").length

console.log(`Flakiness check: ${passed}/5 passed, ${failed}/5 failed`)

if (failed > 0) {
  console.log("Flaky test detected!")
  for (const r of results.filter((r) => r.status === "failed")) {
    console.log(`  Run ${r.id}: ${r.error ?? "test failures"}`)
  }
}
```

## CI/CD Integration

```typescript
// ci-test.ts — run with: bun run ci-test.ts
import { TestPlatform } from "@testplatform/core"

const platform = new TestPlatform()

if (!(await platform.checkDocker())) {
  console.error("Docker is not available")
  process.exit(1)
}

const run = await platform.createRun({
  services: {
    app: {
      image: `${process.env.DOCKER_REGISTRY}/myapp:${process.env.GIT_SHA}`,
      ports: [{ container: 3000 }],
      healthcheck: { type: "http", path: "/health", port: 3000 },
    },
  },
  test: {
    httpChecks: ["http://app:3000/health", "http://app:3000/api/ready"],
    iterations: 3,
    delayMs: 1000,
  },
  cleanup: { onPass: "destroy", onFail: "destroy" },
})

platform.on("log", (_, line) => console.log(line))

const state = await new Promise<RunState>((resolve) => {
  platform.on("finished", (id, s) => {
    if (id === run.id) resolve(s)
  })
})

process.exit(state.status === "passed" ? 0 : 1)
```
