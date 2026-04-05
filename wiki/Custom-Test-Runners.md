# Custom Test Runners

When built-in HTTP checks aren't enough, bring your own test container.

## Configuration

```typescript
{
  test: {
    image: "my-test-image:latest",     // Required: Docker image
    command: ["npm", "test"],           // Required: Command to run
    env: { API_URL: "http://api:3000" }, // Optional: Environment vars
    volumes: ["./tests:/tests:ro"],      // Optional: Volume mounts
  },
}
```

## How It Works

1. Your test image is added to the Compose stack as `test-runner`
2. It depends on all other services (starts after they're healthy)
3. Your command runs inside the container
4. stdout/stderr are streamed as log events
5. **Exit code 0 = passed**, non-zero = failed

## Examples

### pytest

```typescript
{
  image: "python:3.12-slim",
  command: ["sh", "-c", "pip install -r /tests/requirements.txt && pytest -v /tests"],
  volumes: ["./tests:/tests:ro"],
  env: { API_URL: "http://api:3000" },
}
```

### Jest / Vitest

```typescript
{
  image: "node:20-slim",
  command: ["sh", "-c", "cd /app && npm ci && npx jest --forceExit"],
  volumes: ["./test-suite:/app:ro"],
  env: { API_BASE: "http://api:3000" },
}
```

### k6 Load Testing

```typescript
{
  image: "grafana/k6:latest",
  command: ["run", "/scripts/load-test.js"],
  volumes: ["./k6-scripts:/scripts:ro"],
  env: {
    K6_VUS: "100",
    K6_DURATION: "60s",
    BASE_URL: "http://api:3000",
  },
}
```

### Shell Script

```typescript
{
  image: "alpine:latest",
  command: ["sh", "/tests/integration.sh"],
  volumes: ["./scripts:/tests:ro"],
  env: { API_HOST: "api", API_PORT: "3000" },
}
```

## Tips

- **Networking**: Your test container is on the same Docker network. Use service names as hostnames.
- **Dependencies**: The test runner automatically waits for all services to be healthy.
- **Volumes**: Mount test files as read-only (`:ro`) to prevent accidental modification.
- **Exit codes**: Make sure your test framework exits with non-zero on failure.
