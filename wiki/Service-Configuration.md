# Service Configuration

Services are the core building blocks of a test environment. There are two categories: **infrastructure** and **application services**.

## Infrastructure vs Application Services

```typescript
{
  infra: {
    // Infrastructure: databases, caches, queues
    // Boot first, other services depend on these
    postgres: { image: "postgres:16" },
    redis: { image: "redis:7-alpine" },
  },
  services: {
    // Application: your code under test
    // Boot after infrastructure is ready
    api: { image: "my-api:latest", dependsOn: ["postgres", "redis"] },
    worker: { image: "my-worker:latest", dependsOn: ["redis"] },
  },
}
```

Both use the same `ServiceConfig` type. The distinction is semantic and affects boot ordering in the generated Compose file.

## ServiceConfig Reference

```typescript
interface ServiceConfig {
  image: string                         // Required
  env?: Record<string, string>          // Optional
  ports?: PortMapping[]                 // Optional
  healthcheck?: Healthcheck             // Optional
  dependsOn?: string[]                  // Optional
  volumes?: string[]                    // Optional
}
```

### `image` (required)

The Docker image to use. Supports any valid Docker image reference:

```typescript
{ image: "nginx:alpine" }                    // Docker Hub
{ image: "postgres:16-alpine" }              // Specific tag
{ image: "ghcr.io/myorg/myapp:latest" }      // GitHub Container Registry
{ image: "myregistry.com/app:v1.2.3" }       // Private registry
```

Images are pulled with `--pull always` during `docker compose up`.

### `env`

Environment variables passed to the container:

```typescript
{
  image: "my-api:latest",
  env: {
    DATABASE_URL: "postgres://test:test@postgres:5432/testdb",
    REDIS_URL: "redis://redis:6379",
    NODE_ENV: "test",
    LOG_LEVEL: "debug",
  },
}
```

Use Docker Compose service names as hostnames (e.g., `postgres`, `redis`).

### `ports`

Port mappings between container and host:

```typescript
{
  ports: [
    { container: 3000, host: 3000 },   // Exposed to host
    { container: 9090 },                 // Internal only
  ],
}
```

- **With `host`**: Accessible from the host machine at `localhost:<host>`
- **Without `host`**: Only accessible within the Docker network (other containers can reach it via `<service-name>:<container-port>`)

### `healthcheck`

See [Healthchecks](Healthchecks) for full documentation.

### `dependsOn`

Declares dependencies on other services (infrastructure or application):

```typescript
{
  image: "my-api:latest",
  dependsOn: ["postgres", "redis"],
}
```

In the generated Compose file:
- If the dependency has a healthcheck: `condition: service_healthy`
- If no healthcheck: `condition: service_started`

This means Docker Compose will wait for dependencies to be healthy before starting the dependent service.

### `volumes`

Docker volume mounts:

```typescript
{
  volumes: [
    "./config:/app/config:ro",          // Read-only config
    "./data:/app/data",                  // Read-write data
    "named-volume:/var/lib/data",        // Named volume
  ],
}
```

## Common Patterns

### Database with seed data

```typescript
{
  postgres: {
    image: "postgres:16-alpine",
    env: {
      POSTGRES_DB: "test",
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
    },
    volumes: ["./seed.sql:/docker-entrypoint-initdb.d/seed.sql:ro"],
    healthcheck: {
      type: "command",
      command: ["pg_isready", "-U", "test"],
    },
  },
}
```

### Service with multiple ports

```typescript
{
  api: {
    image: "my-api:latest",
    ports: [
      { container: 3000, host: 3000 },   // HTTP API
      { container: 9090, host: 9090 },    // Metrics
      { container: 3001 },                 // gRPC (internal)
    ],
  },
}
```

### Service networking

All services in a run share a Docker network. Use service names as hostnames:

```typescript
// In the api service's env:
{
  DATABASE_URL: "postgres://test:test@postgres:5432/testdb",  // "postgres" = service name
  REDIS_URL: "redis://redis:6379",                              // "redis" = service name
  RABBIT_URL: "amqp://rabbitmq:5672",                           // "rabbitmq" = service name
}
```
