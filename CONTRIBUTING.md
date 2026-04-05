# Contributing to @testplatform/core

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.11
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2
- [Git](https://git-scm.com/)

### Getting Started

1. Fork and clone the repository:

```bash
git clone https://github.com/iazzam-bornan/-testplatform-core.git
cd -testplatform-core
```

2. Install dependencies:

```bash
bun install
```

3. Run the type checker:

```bash
bun run typecheck
```

4. Run the linter:

```bash
bun run lint
```

## Code Style

- **No semicolons**
- **Double quotes** for strings
- **2-space indentation**
- **Trailing commas** in ES5 positions
- **LF line endings**

These are enforced via Prettier and ESLint. Run `bun run format` to auto-format your code.

## Project Structure

```
src/
  index.ts          # Public exports — add new exports here
  types.ts          # All TypeScript interfaces and types
  platform.ts       # TestPlatform class (main orchestrator)
  run.ts            # Run class (lifecycle management)
  docker.ts         # Docker/Compose operations
  test-script.ts    # HTTP test script generator
  storage/
    memory.ts       # In-memory storage
    sqlite.ts       # SQLite storage (Bun native)
```

## Making Changes

### Branch Naming

- `feat/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes
- `refactor/description` — Code refactoring

### Commit Messages

Use clear, concise commit messages:

```
feat: add Redis healthcheck support
fix: handle Docker timeout on slow networks
docs: update storage backend examples
refactor: extract compose generation into separate module
```

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure `bun run typecheck` and `bun run lint` pass
4. Update documentation if you changed the public API
5. Open a pull request with a clear description of what and why

### Adding a New Storage Backend

1. Create a new file in `src/storage/` implementing the `Storage` interface
2. Export it from `src/index.ts`
3. Add documentation in `docs/storage.md`
4. Update the README with a usage example

### Adding a New Healthcheck Type

1. Add the new type to the `Healthcheck` union in `src/types.ts`
2. Handle the new type in `convertHealthcheck()` in `src/docker.ts`
3. Add documentation and examples

### Adding a New Test Type

1. Add the new interface to `src/types.ts`
2. Update the `TestConfig` union type
3. Handle the new type in the compose generation (`src/docker.ts`)
4. Handle execution in `src/run.ts`

## Reporting Issues

When reporting bugs, please include:

- Your environment (OS, Bun version, Docker version)
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or error messages

## Questions?

Open a [GitHub Discussion](https://github.com/iazzam-bornan/-testplatform-core/discussions) or file an issue.
