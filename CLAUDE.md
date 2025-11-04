# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JSON Store is a Git-backed, file-based data store with Mango query language support. It's a monorepo built with pnpm workspaces containing three packages:

- **@jsonstore/sdk** - Core library with types, query engine, formatting utilities, and Store implementation
- **@jsonstore/cli** - Command-line interface (uses commander.js)
- **@jsonstore/server** - MCP server exposing tools for AI agents (uses @modelcontextprotocol/sdk)

## Common Commands

### Development Workflow

```bash
# Install dependencies (must use pnpm)
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm --filter @jsonstore/sdk build
pnpm --filter @jsonstore/cli build
pnpm --filter @jsonstore/server build

# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @jsonstore/sdk test

# Run tests in watch mode
pnpm --filter @jsonstore/sdk test:watch

# Type check all packages
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format

# Clean all build artifacts
pnpm clean
```

### Running Individual Tests

```bash
# Run a single test file
pnpm --filter @jsonstore/sdk test store.test.ts

# Run with vitest CLI options
pnpm --filter @jsonstore/sdk test -- --reporter=verbose
```

### MCP Server

```bash
# Start the MCP server in stdio mode
pnpm --filter @jsonstore/server start

# Development mode (watch)
pnpm --filter @jsonstore/server dev
```

## Architecture

### Data Storage Model

Documents are stored as prettified JSON files following this structure:

```
data/
  <type>/              # Entity type (e.g., "task", "user")
    <id>.json          # Individual document
  <type>/_indexes/     # Optional equality indexes
    <field>.json       # { "<value>": ["<id1>", ...] }
  _meta/
    store.config.json
    manifest.json
```

### Core Components

**SDK Package (`packages/sdk/src/`):**

- `store.ts` - Main Store implementation with CRUD operations
- `cache.ts` - DocumentCache with mtime/size-based invalidation
- `query.ts` - Mango query evaluation engine (operators: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $exists, $type, $and, $or, $not)
- `io.ts` - Atomic file operations (atomicWrite, readDocument, removeDocument, listFiles)
- `format.ts` - Deterministic JSON formatting with stable key ordering
- `validation.ts` - Input validation for keys, documents, and paths
- `types.ts` - Core type definitions

**Query Engine Architecture:**

The query engine in `query.ts` has two execution paths:
1. `matches()` - Evaluates a filter against a single document
2. `evaluateQuery()` - Executes full QuerySpec with filter, projection, sort, skip, limit

All query operations work in-memory. For sorted queries, the engine filters during the scan phase to reduce memory usage rather than loading all docs then filtering.

**Caching Strategy:**

The DocumentCache (`cache.ts`) is a write-through cache that:
- Validates entries on read using mtime and size
- Automatically invalidates on write operations (Store.put/remove calls cache.delete())
- Can be disabled via JSONSTORE_CACHE_SIZE=0 environment variable

**File I/O Pattern:**

All writes use atomic operations (write to temp file + rename) implemented in `io.ts:atomicWrite()`. This ensures consistency even with concurrent access.

### Package Dependencies

```
@jsonstore/cli ──depends on──> @jsonstore/sdk
@jsonstore/server ──depends on──> @jsonstore/sdk
```

SDK is the core library with zero dependencies (except dev dependencies). Both CLI and server consume it as `workspace:*`.

### Key Design Patterns

1. **Deterministic Formatting**: All documents are formatted with `stableStringify()` using alphabetical key ordering (configurable) and consistent indentation for clean Git diffs.

2. **Type Safety**: Store enforces that all documents have `type` and `id` fields matching their Key via `validateDocument()`.

3. **No-op Write Optimization**: `Store.put()` reads the existing file first and skips the write if content is unchanged.

4. **Dot-path Queries**: Query engine supports nested field access via dot notation (e.g., `"address.city"`) using `getPath()`.

5. **Lazy Indexing**: Indexes are optional and created on-demand with `ensureIndex()`. They're stored as sidecar files in `_indexes/`.

## TypeScript Configuration

- ES Modules only (`"type": "module"` in all package.json files)
- Target: ES2022
- Module: NodeNext
- Composite project references enabled
- Test files (*.test.ts) excluded from build

## Testing

- Framework: Vitest
- Test files use `.test.ts` suffix
- Integration tests use `.integration.test.ts` suffix
- Tests are colocated with source files in `src/`
- Run tests from package directories or use `pnpm --filter <package> test`

## Git Workflow

- Main branch: `main`
- Development branch: `develop`
- Currently on: `develop`
- Clean working directory (no uncommitted changes)

## Implementation Status

The SDK has completed Store CRUD operations (put/get/remove/list) and full query engine with Mango operators. See README.md for detailed stage-by-stage implementation status.

## Important Conventions

1. **Import Extensions**: Always use `.js` extension in imports even though source files are `.ts` (required for ES modules)
   ```typescript
   import { Store } from "./types.js";  // Not "./types"
   ```

2. **Path Validation**: All user-provided paths are validated with `sanitizePath()` to prevent directory traversal attacks.

3. **Error Handling**: Use specific error classes from `errors.ts` (DocumentNotFoundError, DocumentWriteError, etc.)

4. **Cache Invalidation**: After any write operation, call `this.#cache.delete(filePath)` to prevent serving stale data.

5. **Git Integration**: Git commits are optional and non-blocking. Errors are logged but don't fail the operation.

6. **Current Information**: When you need up-to-date information about packages, platforms, APIs, or documentation (especially as of 2025), use the `ask_google` MCP tool to get fresh information from the web rather than relying on potentially outdated knowledge.
