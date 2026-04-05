# Installation

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Bun](https://bun.sh) | >= 1.3.11 | Runtime & package manager |
| [Docker](https://docs.docker.com/get-docker/) | Latest | Container runtime |
| Docker Compose | v2 | Multi-container orchestration |

### Verify Prerequisites

```bash
# Check Bun
bun --version
# 1.3.11

# Check Docker
docker info
# Should print Docker Engine version and details

# Check Docker Compose
docker compose version
# Docker Compose version v2.x.x
```

## Install the Package

### With Bun (recommended)

```bash
bun add @testplatform/core
```

### With npm

```bash
npm install @testplatform/core
```

### With pnpm

```bash
pnpm add @testplatform/core
```

## Verify Installation

```typescript
import { TestPlatform } from "@testplatform/core"

const platform = new TestPlatform()
const dockerOk = await platform.checkDocker()
console.log(`Docker available: ${dockerOk}`)
```

Run with:

```bash
bun run verify.ts
```

Expected output:

```
Docker available: true
```

## TypeScript Configuration

The package is written in TypeScript and ships with full type definitions. No additional `@types/` packages needed.

Recommended `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```
