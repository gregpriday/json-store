# JSON Store

A Git-backed, file-based data store with Mango query language support, designed for AI agents and human collaboration.

## Overview

JSON Store is an internal, JSON-first data store that stores documents as prettified, human-readable JSON files in a Git repository. It provides:

- **Git-native storage**: One JSON file per entity, with deterministic formatting for clean diffs
- **Mango query language**: MongoDB-style queries for filtering, sorting, and projecting
- **MCP server**: Tools for AI agents to interact with the store
- **CLI**: Human-friendly command-line interface
- **TypeScript SDK**: Core library for building integrations with Next.js, SvelteKit, or any framework

## Architecture

```
data/
  <type>/
    <id>.json              # Entity document (prettified, stable key order)
  <type>/_indexes/         # Optional helper indexes (sidecar JSON)
    <field>.json           # { "<value>": ["<id>", ...], ... }
  _meta/
    store.config.json      # Store-wide config
    manifest.json          # Build/version info
```

## Packages

This is a monorepo containing:

- **@jsonstore/sdk** - Core SDK with types, query engine, and formatting utilities (use in Next.js, SvelteKit, etc.)
- **@jsonstore/cli** - Command-line interface for store operations
- **@jsonstore/server** - MCP server exposing tools for AI agents

## Quick Start

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Basic Usage

```bash
# Initialize a new store
jsonstore init --dir ./data

# Store a document
jsonstore put task abc123 --data '{
  "type": "task",
  "id": "abc123",
  "title": "Fix bug",
  "status": "open",
  "priority": 5
}'

# Retrieve a document
jsonstore get task abc123

# Query documents
jsonstore query --type task --data '{
  "filter": { "status": { "$eq": "open" } },
  "sort": { "priority": -1 },
  "limit": 10
}'

# List all IDs for a type
jsonstore ls task
```

## Query Language

JSON Store supports a Mango-style query language:

### Operators

- **Equality**: `$eq`, `$ne`, `$in`, `$nin`
- **Range**: `$gt`, `$gte`, `$lt`, `$lte`
- **Logical**: `$and`, `$or`, `$not`
- **Existence**: `$exists`, `$type`

### Example Queries

```json
{
  "type": "task",
  "filter": {
    "$and": [{ "status": { "$in": ["open", "ready"] } }, { "priority": { "$gte": 5 } }]
  },
  "projection": { "id": 1, "title": 1, "priority": 1 },
  "sort": { "priority": -1, "title": 1 },
  "limit": 100,
  "skip": 0
}
```

## MCP Server

The MCP server exposes tools for AI agents:

### Tools

- `get_doc` - Retrieve a document by type and ID
- `put_doc` - Store or update a document
- `rm_doc` - Remove a document
- `list_ids` - List all IDs for a type
- `query` - Execute Mango queries
- `ensure_index` - Create equality indexes for fast lookups
- `git_commit` - Commit changes to Git

### Running the Server

```bash
# Start the MCP server (stdio mode)
pnpm --filter @jsonstore/server start
```

## Development

### Project Structure

```
json-store/
├── packages/
│   ├── sdk/          # Core library
│   ├── cli/          # Command-line interface
│   ├── server/       # MCP server
│   └── frontend/     # Web viewer
├── package.json      # Root package
└── pnpm-workspace.yaml
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @jsonstore/sdk build
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @jsonstore/sdk test

# Watch mode
pnpm --filter @jsonstore/sdk test:watch
```

### Type Checking

```bash
# Type check all packages
pnpm typecheck
```

## Implementation Status

This is the initial scaffolding for JSON Store. The following components are currently in place:

### Completed (Stage 1)

- [x] Monorepo structure with pnpm workspaces
- [x] TypeScript configuration
- [x] Core type definitions
- [x] Query engine implementation (format, query, validation)
- [x] CLI command structure
- [x] MCP server scaffolding with tool definitions
- [x] Test framework setup

### Planned Implementation

#### Stage 2 - Core File I/O

- [ ] Atomic file write operations
- [ ] Document read/write/delete
- [ ] Directory structure creation

#### Stage 3 - SDK CRUD Operations

- [ ] In-memory document cache
- [ ] Full CRUD implementation
- [ ] List operations

#### Stage 4 - Query Engine

- [ ] Full Mango operator support
- [ ] Sorting and pagination
- [ ] Projection

#### Stage 5 - CLI Implementation

- [ ] Wire up all commands
- [ ] File and stdin input
- [ ] Pretty output formatting

#### Stage 6 - Optional Indexes

- [ ] Sidecar equality indexes
- [ ] Index maintenance on writes
- [ ] Fast path for indexed queries

#### Stage 7 - MCP Server

- [ ] Wire up tool implementations
- [ ] Git commit support
- [ ] Batch commit coalescing

#### Stage 8 - Frontend

- [ ] Document browsing
- [ ] Client-side query execution
- [ ] Caching and manifest support

#### Stage 9 - Documentation

- [ ] API reference
- [ ] Query language guide
- [ ] MCP tool catalog
- [ ] Operations runbook

## Performance Guidelines

JSON Store is optimized for:

- **Sweet spot**: ≤25k documents per type
- **Document size**: ≤100 KB typical
- **Total size**: ≤1-2 GB aggregate

Performance strategies:

- In-memory caching with mtime/size invalidation
- Optional sidecar indexes for hot fields
- Client-side caching with ETag/Last-Modified

## Git Integration

### Deterministic Formatting

All documents are formatted with:

- Stable alphabetical key ordering (or custom order)
- 2-space indentation
- UTF-8 encoding
- Trailing newline

This ensures clean, predictable diffs in Git.

### Workflow

```bash
# Format all documents
jsonstore format --all

# Commit with message
jsonstore put task abc123 --data '...' --git-commit "feat(data): add task abc123"
```

## Security

For internal/local use:

- MCP server binds to localhost only
- Path validation prevents directory traversal
- Input sanitization on all operations

## License

MIT

## Contributing

This is an internal tool. See implementation plan in the main spec for contribution guidelines and phased rollout.
