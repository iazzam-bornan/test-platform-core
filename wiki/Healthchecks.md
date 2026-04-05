# Healthchecks

Healthchecks ensure services are ready before tests begin. The platform polls Docker's native health status and waits until all services with healthchecks report `healthy`.

## Overview

When a service has a `healthcheck` configured:
1. Docker runs the check at the specified interval
2. The platform polls `docker inspect` for health status
3. The run waits in `waiting_healthy` until all services pass
4. If any service becomes `unhealthy`, the run fails with an error

Services **without** healthchecks are considered ready as soon as the container starts.

## Healthcheck Types

### HTTP

Verifies an HTTP endpoint returns a successful response.

```typescript
{
  type: "http",
  path: "/health",
  port: 3000,
  interval: 5,    // seconds between checks (default: 5)
  timeout: 10,    // seconds before check times out (default: 10)
  retries: 5,     // failures before unhealthy (default: 5)
}
```

**How it works:** The generated Docker healthcheck tries three methods in order:
1. `wget --spider -q` (works in Alpine images)
2. `curl -sf` (works in Debian/Ubuntu images)
3. Node.js `fetch()` (works in Node images)

This makes HTTP healthchecks work with any base image.

### Command

Runs a command inside the container. Exit code 0 = healthy.

```typescript
{
  type: "command",
  command: ["pg_isready", "-U", "postgres"],
  interval: 5,
  timeout: 10,
  retries: 5,
}
```

**Common commands:**

| Service | Command |
|---|---|
| PostgreSQL | `["pg_isready", "-U", "<user>"]` |
| MySQL | `["mysqladmin", "ping", "-h", "localhost"]` |
| MongoDB | `["mongosh", "--eval", "db.runCommand('ping')"]` |
| RabbitMQ | `["rabbitmq-diagnostics", "check_running"]` |
| Elasticsearch | `["curl", "-sf", "http://localhost:9200/_cluster/health"]` |

### TCP

Checks that a TCP port is accepting connections using `nc` (netcat).

```typescript
{
  type: "tcp",
  port: 6379,
  interval: 5,
  timeout: 10,
  retries: 5,
}
```

**Best for:** Redis, Memcached, and other services where a simple port check is sufficient.

## Timing Parameters

All healthcheck types share these optional parameters:

| Parameter | Default | Description |
|---|---|---|
| `interval` | `5` | Seconds between each health check attempt |
| `timeout` | `10` | Seconds before a single check attempt times out |
| `retries` | `5` | Number of consecutive failures before marking unhealthy |

**Tip:** For slow-starting services (like databases with migrations), increase `retries` and `interval`:

```typescript
{
  type: "command",
  command: ["pg_isready", "-U", "test"],
  interval: 10,
  timeout: 15,
  retries: 12,   // Up to 2 minutes to become healthy
}
```

## Health Status Events

The platform emits `service:health` events as health changes:

```typescript
platform.on("service:health", (runId, service, health) => {
  // health: "unknown" | "starting" | "healthy" | "unhealthy"
  console.log(`${service}: ${health}`)
})
```

Typical progression: `unknown` -> `starting` -> `healthy`

## Dependency Interaction

When a service has both `healthcheck` and `dependsOn`:

```typescript
{
  api: {
    image: "my-api:latest",
    healthcheck: { type: "http", path: "/health", port: 3000 },
    dependsOn: ["postgres"],
  },
  postgres: {
    image: "postgres:16",
    healthcheck: { type: "command", command: ["pg_isready", "-U", "test"] },
  },
}
```

Docker Compose will:
1. Start `postgres` first
2. Wait for `postgres` to be healthy
3. Then start `api`
4. The platform waits for `api` to be healthy too
5. Only then does the test runner start
