# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JSON Store is a Git-backed, file-based data store with Mango query language support. It's a monorepo built with pnpm workspaces containing four packages:

- **@jsonstore/sdk** - Core library with types, query engine, formatting utilities, and Store implementation
- **@jsonstore/cli** - Command-line interface (uses commander.js)
- **@jsonstore/server** - MCP server exposing tools for AI agents (uses @modelcontextprotocol/sdk)
- **@jsonstore/testkit** - Shared testing utilities for integration tests

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
  <type>/                    # Entity type (e.g., "task", "user")
    <id>.json                # Individual document
  <type>/_indexes/           # Optional equality indexes
    <field>.json             # { "<value>": ["<id1>", ...] }
  <type>/_slugs/             # Optional slug indexes (when slug support enabled)
    <scope>/                 # Scope dimension (e.g., "US", "GB")
      <slug>.json            # { "id": "<id>", "aliases": [...] }
  <type>/_hierarchy/         # Optional hierarchical indexes (when hierarchy enabled)
    children/<parentId>.json # Child IDs for pagination
    by-path/<pathHash>.json  # Document lookup by materialized path
  _meta/
    store.config.json        # Store configuration
    manifest.json            # Version/metadata
    schemas/                 # JSON Schema registry
      <kind>@<version>.json  # Schema definitions
```

### Core Components

**SDK Package (`packages/sdk/src/`):**

Core modules:
- `store.ts` - Main Store implementation with CRUD operations
- `cache.ts` - DocumentCache with mtime/size-based invalidation
- `query.ts` - Mango query evaluation engine (operators: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $exists, $type, $and, $or, $not)
- `io.ts` - Atomic file operations (atomicWrite, readDocument, removeDocument, listFiles)
- `format.ts` & `format/canonical.ts` - Deterministic JSON formatting with stable key ordering
- `validation.ts` - Input validation for keys, documents, paths, and schemas
- `types.ts` - Core type definitions
- `errors.ts` - Custom error classes
- `indexes.ts` - Secondary index management for fast queries
- `slug.ts` - Slug generation and management for human-readable identifiers

Hierarchical storage (`hierarchy/`):
- `hierarchy-manager.ts` - Parent-child relationships and materialized paths
- `codec.ts` - Path encoding/decoding and slug normalization
- `by-path-adapter.ts` - Path-based document lookups
- `lock.ts` - Fine-grained locking for concurrent operations
- `txn/` - Transaction support for index updates (WAL-based)

Schema validation (`schema/`):
- `registry.ts` - JSON Schema storage and compilation
- `validator.ts` - Runtime schema validation with AJV
- `formats.ts` - Custom format validators (slug, ISO codes, markdown paths)

Observability (`observability/`):
- `logs.ts` - Structured logging
- `metrics.ts` - Performance metrics tracking

Testing utilities (`contracts/`):
- `cli.ts`, `query.ts`, `index.ts` - Contract tests for interfaces

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
@jsonstore/testkit ──depends on──> @jsonstore/sdk
```

SDK is the core library with production dependencies (ajv, ajv-errors, ajv-formats for schema validation). All packages consume SDK as `workspace:*`.

**Production Dependencies:**
- SDK: ajv@^8.17.1, ajv-errors@^3.0.0, ajv-formats@^3.0.1
- CLI: commander@^12.0.0
- Server: @modelcontextprotocol/sdk@^1.0.4, zod@^4.1.12
- Testkit: execa@^9.0.0

### Key Design Patterns

1. **Deterministic Formatting**: All documents are formatted with `stableStringify()` using alphabetical key ordering (configurable) and consistent indentation for clean Git diffs.

2. **Type Safety**: Store enforces that all documents have `type` and `id` fields matching their Key via `validateDocument()`.

3. **No-op Write Optimization**: `Store.put()` reads the existing file first and skips the write if content is unchanged.

4. **Dot-path Queries**: Query engine supports nested field access via dot notation (e.g., `"address.city"`) using `getPath()`.

5. **Lazy Indexing**: Indexes are optional and created on-demand with `ensureIndex()`. They're stored as sidecar files in `_indexes/`.

6. **Hierarchical Storage**: Documents can have parent-child relationships with materialized paths for efficient ancestor queries. Supports slug-based resolution within scopes.

7. **Schema Validation**: Optional JSON Schema validation with three modes (strict, lenient, off). Schemas stored in `_meta/schemas/` with versioning support.

8. **Slug Management**: First-class support for human-readable identifiers with automatic collision resolution, scope-based uniqueness, and alias tracking for redirects.

9. **Observability**: Structured logging and metrics tracking for production monitoring and debugging.

## TypeScript Configuration

- ES Modules only (`"type": "module"` in all package.json files)
- Target: ES2022
- Module: NodeNext
- Composite project references enabled
- Test files (\*.test.ts) excluded from build

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

## Recent Major Changes

The following major features were added in recent pull requests:

1. **PR #30 - Slug Support**: First-class slug support for human-readable identifiers with collision resolution, scope-based uniqueness, and alias tracking for redirects (packages/sdk/src/slug.ts).

2. **PR #31 - JSON Schema Validation**: Runtime type safety with AJV-based schema validation, custom format validators, and schema registry with versioning (packages/sdk/src/schema/).

3. **PR #29 - Hierarchical Storage**: Parent-child relationships with materialized paths, secondary indexes, slug-based resolution within scopes, and WAL-based transactions (packages/sdk/src/hierarchy/).

## Implementation Status

JSON Store is feature-complete with all planned functionality implemented and tested:

**Core Features (Completed):**
- ✅ Store CRUD operations (put/get/remove/list)
- ✅ Full Mango query engine with all operators
- ✅ Secondary equality indexes with automatic maintenance
- ✅ Document caching with mtime/size validation
- ✅ Deterministic formatting for clean Git diffs
- ✅ Atomic file operations with TOCTOU guards

**Advanced Features (Completed):**
- ✅ Hierarchical storage with parent-child relationships
- ✅ Materialized paths for efficient ancestor queries
- ✅ Slug management with collision resolution and scope support
- ✅ JSON Schema validation with AJV integration
- ✅ Custom format validators (slug, ISO codes, etc.)
- ✅ Schema registry with versioning
- ✅ Observability (structured logging and metrics)
- ✅ WAL-based transactions for index consistency

**Packages (Completed):**
- ✅ CLI with all commands (init, put, get, remove, query, format, schema, etc.)
- ✅ MCP server with tools for AI agents
- ✅ Testkit for shared integration testing utilities
- ✅ Comprehensive test coverage (262+ tests passing across all packages)

See README.md for detailed feature documentation and examples.

## Important Conventions

1. **Import Extensions**: Always use `.js` extension in imports even though source files are `.ts` (required for ES modules)

   ```typescript
   import { Store } from "./types.js"; // Not "./types"
   ```

2. **Path Validation**: All user-provided paths are validated with `sanitizePath()` to prevent directory traversal attacks.

3. **Error Handling**: Use specific error classes from `errors.ts` (DocumentNotFoundError, DocumentWriteError, etc.)

4. **Cache Invalidation**: After any write operation, call `this.#cache.delete(filePath)` to prevent serving stale data.

5. **Git Integration**: Git commits are optional and non-blocking. Errors are logged but don't fail the operation.

6. **Schema References**: Use the format `schema/<kind>@<major>` (e.g., "schema/city@1") for schema references.

7. **Hierarchical Keys**: When using hierarchical storage, slugs must be unique within their scope (defined by scope dimensions like country/region).

8. **Index Versioning**: The SDK uses `indexVersion` for backward compatibility tracking. Current version is 1.

9. **Observability**: Use structured logging via `observability/logs.ts` for consistent log format. Metrics are tracked in `observability/metrics.ts`.

10. **Testing**:
    - Unit tests use `.test.ts` suffix
    - Integration tests use `.integration.test.ts` suffix
    - Performance benchmarks are opt-in via `VITEST_PERF=1` environment variable
    - Use `@jsonstore/testkit` for shared test utilities

11. **Current Information**: When you need up-to-date information about packages, platforms, APIs, or documentation (especially as of 2025), use the `ask_google` MCP tool to get fresh information from the web rather than relying on potentially outdated knowledge.
