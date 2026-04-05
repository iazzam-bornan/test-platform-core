# Parallel Runs

Run multiple test environments simultaneously for flakiness detection, load testing, or testing different configurations.

## Basic Usage

```typescript
const runs = await platform.createParallelRuns(config, 5)
// 5 isolated Docker stacks running the same test
```

Each run gets its own:
- Unique ID
- Docker Compose project (isolated containers)
- Docker network
- Workspace directory

## Collecting Results

```typescript
const results = await Promise.all(
  runs.map(run =>
    new Promise<RunState>(resolve => {
      platform.on("finished", (id, state) => {
        if (id === run.id) resolve(state)
      })
    })
  )
)

const passed = results.filter(r => r.status === "passed").length
console.log(`${passed}/${results.length} passed`)
```

## Use Cases

### Flakiness Detection

Run the same test multiple times to detect non-deterministic failures:

```typescript
const runs = await platform.createParallelRuns(config, 10)
// If any run fails while others pass, you likely have a flaky test
```

### Different Configurations

Create separate runs with variations:

```typescript
const configs = [
  { ...baseConfig, services: { api: { ...baseApi, image: "api:v1" } } },
  { ...baseConfig, services: { api: { ...baseApi, image: "api:v2" } } },
]

const runs = await Promise.all(configs.map(c => platform.createRun(c)))
```

## Resource Considerations

Each parallel run starts a full Docker Compose stack. Monitor:
- **CPU/Memory**: Each stack runs multiple containers
- **Ports**: Avoid host port conflicts between runs (use internal-only ports or different host ports)
- **Disk**: Compose files and logs accumulate in the workspace directory
