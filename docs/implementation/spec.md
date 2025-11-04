# JSON-First Queryable Store — Full Technical Specification

**Version:** 0.1.0
**Last Updated:** 2025-01-04

---

## 1) Purpose & Scope

Build an internal, **Node.js/TypeScript** system that persists data as **one prettified JSON file per entity** under a Git-tracked folder, supports **Mango-style queries**, and exposes **three integration surfaces**:

1. **SDK** (Node/TS) — Core library for programmatic access
2. **CLI** (developer & automation) — Command-line interface for humans and scripts
3. **MCP server** (local; used by an AI agent) — Tools for AI agent interaction

The store favors **determinism, simplicity, and Git-friendliness** over raw speed. Optional **sidecar indexes** provide fast equality lookups when needed.

### Design Principles

- **Git-native**: Every write is Git-friendly with deterministic formatting
- **Human-readable**: Prettified JSON with stable key ordering
- **Agent-ready**: MCP server exposes discoverable tools with JSON Schemas
- **Performance-conscious**: In-memory caching + optional indexes for hot fields
- **Type-safe**: Full TypeScript support throughout

---

## 2) Data Model & On-Disk Layout

### Root Directory Structure

**Root directory:** configurable (default `./data`)

```
data/
  <type>/
    <id>.json                # one file per entity (prettified, stable key order)
    _indexes/                # optional helper indexes (JSON sidecars)
      <field>.json           # equality map: { "<value>": ["<id>", ...], ... }
  _meta/
    store.config.json        # store-wide settings
    manifest.json            # optional: version/commit info for clients and tooling
```

### Document Requirements

Each file contains a single JSON object with:

- **`type: string`** (must match folder name)
- **`id: string`** (must match filename without `.json`)

**Formatting Rules (Canonical):**

- UTF-8 encoding
- 2-space indentation (configurable)
- Trailing newline
- **Stable key ordering** (alphabetical by default, or custom order)
- No binary or minified data

**Filename Constraints:**

- Allowed characters: `[A-Za-z0-9_.-]+` to ensure cross-platform portability
- Must not start with `.` or `-`
- Must not contain `..` or `//`

### Write Semantics

**Atomic-ish writes:**

1. Write to temporary file: `.<id>.json.tmp`
2. `fsync` the temporary file
3. `rename` to `<id>.json`
4. `fsync` the parent directory

**Guarantees:**

- Byte-stable re-writes (no spurious diffs when logically unchanged)
- Crash-safe (either old or new version exists, never partial)
- Git-friendly (clean diffs with one file per entity)

---

## 3) Query Language (Mango-style, Deterministic)

### Filter Operators

**Field-level operators:**

| Operator  | Description           | Example                                            |
| --------- | --------------------- | -------------------------------------------------- |
| `$eq`     | Equals                | `{ "status": { "$eq": "open" } }`                  |
| `$ne`     | Not equals            | `{ "status": { "$ne": "closed" } }`                |
| `$in`     | In array              | `{ "status": { "$in": ["open", "ready"] } }`       |
| `$nin`    | Not in array          | `{ "status": { "$nin": ["closed", "archived"] } }` |
| `$gt`     | Greater than          | `{ "priority": { "$gt": 5 } }`                     |
| `$gte`    | Greater than or equal | `{ "priority": { "$gte": 5 } }`                    |
| `$lt`     | Less than             | `{ "priority": { "$lt": 10 } }`                    |
| `$lte`    | Less than or equal    | `{ "priority": { "$lte": 10 } }`                   |
| `$exists` | Field exists          | `{ "assignee": { "$exists": true } }`              |
| `$type`   | Type check            | `{ "tags": { "$type": "array" } }`                 |

**Logical operators:**

| Operator | Description               | Example                                                             |
| -------- | ------------------------- | ------------------------------------------------------------------- |
| `$and`   | All conditions must match | `{ "$and": [{ "status": "open" }, { "priority": { "$gte": 5 } }] }` |
| `$or`    | Any condition must match  | `{ "$or": [{ "status": "open" }, { "status": "ready" }] }`          |
| `$not`   | Negation                  | `{ "$not": { "status": { "$eq": "closed" } } }`                     |

### Paths, Projection & Sort

**Dot-paths for nested fields:**

```json
{
  "filter": {
    "author.name": { "$eq": "Alice" },
    "meta.tags.0": { "$eq": "urgent" }
  }
}
```

**Projection (inclusion semantics):**

```json
{
  "projection": {
    "id": 1,
    "title": 1,
    "priority": 1
  }
}
```

**Sort (stable comparator):**

```json
{
  "sort": {
    "priority": -1,
    "title": 1
  }
}
```

### Query Envelope

Complete query specification:

```json
{
  "type": "task",
  "filter": {
    "status": { "$in": ["open", "ready"] },
    "priority": { "$gte": 5 }
  },
  "projection": {
    "id": 1,
    "title": 1,
    "priority": 1
  },
  "sort": {
    "priority": -1,
    "title": 1
  },
  "limit": 100,
  "skip": 0
}
```

### Evaluation Model (MVP)

**Baseline approach:**

1. **Folder-bounded scan** (if `type` provided) or all types otherwise
2. Parse each JSON file
3. Evaluate filter predicates in memory
4. Apply stable sort
5. Project fields
6. Paginate (skip/limit)

This naive approach is sufficient for the target scale (≤25k docs per type).

---

## 4) Performance Model

### Baseline Performance

**In-process cache:**

- Cache key per document: `{type, id, mtimeMs, size}` → parsed object
- Warm reads avoid re-parsing unless file metadata changes
- Cache invalidation on write operations

**Expected performance (local SSD):**

- 1,000 docs (2-10 KB each), single-type query:
  - **Cold:** < 150 ms
  - **Warm (cached):** < 30 ms

### Optional Helper Indexes (Equality)

**Sidecar structure:**

```
data/<type>/_indexes/<field>.json
```

**Content example:**

```json
{
  "open": ["task-001", "task-042", "task-077"],
  "ready": ["task-003", "task-014"],
  "closed": ["task-002", "task-005"]
}
```

**Fast path:**

- Queries of the form `{ "<field>": { "$eq": "<value>" } }` resolve to a small ID set
- Only matching files are parsed
- Often reduces query time to **< 10 ms** for small result sets

**Maintenance:**

- Updated automatically on `put/remove` operations
- Rebuilt by CLI: `ensure-index`, `reindex`
- Consistency checks available

### Operational Sweet Spot

**Recommended limits:**

- ≤ 25,000 documents per type
- Typical document size ≤ 100 KB
- Aggregate store size ≤ 1-2 GB

**Scale-up strategies:**

- Add additional sidecar indexes for hot fields
- Implement range/compound indexes (future)
- Consider pluggable adapter for SQLite JSON backend (future)

---

## 5) SDK (Node/TypeScript)

### Package

**Name:** `@jsonstore/sdk`

### Core Interfaces

```typescript
export interface StoreOptions {
  /** Root directory for the data store (e.g., "./data") */
  root: string;
  /** Number of spaces for JSON indentation (default: 2) */
  indent?: number;
  /** Key ordering strategy: "alpha" or explicit array */
  stableKeyOrder?: "alpha" | string[];
  /** Enable file system watching to refresh caches (optional) */
  watch?: boolean;
  /** Auto-maintain indexes: { [type]: [field, ...] } */
  indexes?: Record<string, string[]>;
}

export interface Key {
  /** Entity type (maps to folder name) */
  type: string;
  /** Entity ID (maps to filename without .json) */
  id: string;
}

export type Document = Record<string, any> & {
  type: string;
  id: string;
};

export type Filter = any; // Mango filter object

export type Projection = Record<string, 0 | 1>;

export type Sort = Record<string, 1 | -1>;

export interface QuerySpec {
  /** Optional: limit to a specific type */
  type?: string;
  /** Mango filter object */
  filter: Filter;
  /** Optional: fields to include/exclude */
  projection?: Projection;
  /** Optional: sort specification */
  sort?: Sort;
  /** Optional: maximum results */
  limit?: number;
  /** Optional: skip N results */
  skip?: number;
}

export interface Store {
  /**
   * Store or update a document
   */
  put(key: Key, doc: Document, opts?: { gitCommit?: string }): Promise<void>;

  /**
   * Retrieve a document by key
   */
  get(key: Key): Promise<Document | null>;

  /**
   * Remove a document
   */
  remove(key: Key, opts?: { gitCommit?: string }): Promise<void>;

  /**
   * List all document IDs for a type
   */
  list(type: string): Promise<string[]>;

  /**
   * Query documents using Mango query language
   */
  query(q: QuerySpec): Promise<Document[]>;

  /**
   * Ensure an equality index exists for fast lookups
   */
  ensureIndex(type: string, field: string): Promise<void>;

  /**
   * Format documents to canonical representation
   */
  format(target?: { all?: true } | { type: string; id?: string }): Promise<void>;

  /**
   * Get statistics for the store or a type
   */
  stats(type?: string): Promise<{ count: number; bytes: number }>;

  /**
   * Close the store and clean up resources
   */
  close(): Promise<void>;
}

/**
 * Open a JSON store
 */
export function openStore(options: StoreOptions): Store;
```

### Key Behaviors

**Deterministic writes:**

- Internal `stableStringify` function ensures consistent output
- Stable key ordering (alphabetical or custom)
- Configurable indentation
- Trailing newline

**Atomic operations:**

- Write-then-rename pattern for crash safety
- Safe for Git operations

**Index maintenance:**

- When configured, SDK updates sidecar equality maps in `put/remove`
- Transparent to callers

**Caching:**

- Cached reads invalidated on mtime/size change
- Per-process in-memory cache
- Optional file system watching for external changes

**Git integration (optional):**

- If `gitCommit` option provided, SDK executes:
  - `git add <file>`
  - `git commit -m "<message>"`
- Configurable via hooks

---

## 6) CLI

### Binary

**Name:** `jsonstore`

### Commands

```bash
# Initialize a new store
jsonstore init [--dir ./data]

# Store or update a document
jsonstore put <type> <id> (--file path.json | --data '<json>') [--git-commit "msg"]

# Retrieve a document
jsonstore get <type> <id> [--raw]

# Remove a document
jsonstore rm <type> <id> [--force] [--git-commit "msg"]

# List all IDs for a type
jsonstore ls <type> [--json]

# Query documents
jsonstore query (--file q.json | --data '<json>') [--type <type>] [--limit N] [--skip N]

# Format documents to canonical representation
jsonstore format [--all | <type> [<id>]]

# Create or update an equality index
jsonstore ensure-index <type> <field>

# Rebuild indexes for a type
jsonstore reindex <type> [<field>...]

# Show statistics
jsonstore stats [--type <type>]
```

### Behavior & UX

**Input/Output:**

- Reads/writes **canonical** JSON
- `put` validates `type/id` presence and path consistency
- `query` prints pretty JSON by default
- Supports stdin for pipelines
- `--json` flag for machine-readable output

**Formatting:**

- `format` is a **no-op** when bytes are already canonical
- Guarantees "no drift" on re-format
- Can be used in pre-commit hooks

**Exit Codes:**

| Code | Meaning          |
| ---- | ---------------- |
| 0    | Success          |
| 1    | Validation error |
| 2    | Not found        |
| 3    | I/O error        |

### Example Usage

```bash
# Initialize store
jsonstore init --dir ./my-data

# Add a task
jsonstore put task abc123 --data '{
  "type": "task",
  "id": "abc123",
  "title": "Fix bug",
  "status": "open",
  "priority": 5
}' --git-commit "feat(data): add task abc123"

# Query open tasks
jsonstore query --type task --data '{
  "filter": { "status": { "$eq": "open" } },
  "sort": { "priority": -1 },
  "limit": 10
}'

# Create index for fast status lookups
jsonstore ensure-index task status

# Format all documents
jsonstore format --all
```

---

## 7) MCP Server (for the Local AI Agent)

### Purpose

Let an AI agent **use tools over MCP** to read/write/query the JSON store, optionally committing to Git.

### Transport Options

**Streamable HTTP (recommended):**

- Local server on `http://127.0.0.1:<PORT>`
- Low friction, works with OpenAI Agents SDK
- Supports tool discovery and streaming results

**stdio (simplest):**

- Run as child process
- Dead-simple local tooling
- Also supported by OpenAI Agents SDK

### Tool Catalog

All tools are self-described via **JSON Schemas** in the MCP descriptor.

#### 1. `get_doc`

**Description:** Retrieve a document by type and ID

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string", "description": "Entity type" },
    "id": { "type": "string", "description": "Document ID" }
  },
  "required": ["type", "id"]
}
```

**Output:**

```json
{
  "doc": { "type": "task", "id": "abc123", ... }
}
```

#### 2. `put_doc`

**Description:** Store or update a document

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string", "description": "Entity type" },
    "id": { "type": "string", "description": "Document ID" },
    "doc": { "type": "object", "description": "Document to store" },
    "commit": {
      "type": "object",
      "properties": {
        "message": { "type": "string", "description": "Commit message" },
        "batch": { "type": "string", "description": "Batch identifier" }
      }
    }
  },
  "required": ["type", "id", "doc"]
}
```

**Output:**

```json
{ "ok": true }
```

#### 3. `rm_doc`

**Description:** Remove a document

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string", "description": "Entity type" },
    "id": { "type": "string", "description": "Document ID" },
    "commit": {
      "type": "object",
      "properties": {
        "message": { "type": "string", "description": "Commit message" }
      }
    }
  },
  "required": ["type", "id"]
}
```

**Output:**

```json
{ "ok": true }
```

#### 4. `list_ids`

**Description:** List all document IDs for a type

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string", "description": "Entity type to list" }
  },
  "required": ["type"]
}
```

**Output:**

```json
{
  "ids": ["abc123", "def456", "ghi789"]
}
```

#### 5. `query`

**Description:** Execute Mango queries

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string", "description": "Optional type restriction" },
    "filter": { "type": "object", "description": "Mango filter object" },
    "projection": { "type": "object", "description": "Fields to include/exclude" },
    "sort": { "type": "object", "description": "Sort specification" },
    "limit": { "type": "number", "description": "Maximum results" },
    "skip": { "type": "number", "description": "Skip N results" }
  },
  "required": ["filter"]
}
```

**Output:**

```json
{
  "results": [
    { "id": "abc123", "title": "Task 1", ... },
    { "id": "def456", "title": "Task 2", ... }
  ]
}
```

#### 6. `ensure_index`

**Description:** Create or update an equality index for fast lookups

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string", "description": "Entity type" },
    "field": { "type": "string", "description": "Field name to index" }
  },
  "required": ["type", "field"]
}
```

**Output:**

```json
{ "ok": true }
```

#### 7. `git_commit` (optional explicit control)

**Description:** Commit staged changes to git

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "message": { "type": "string", "description": "Commit message" },
    "add": {
      "type": "array",
      "items": { "type": "string" },
      "description": "File paths to stage before committing"
    }
  },
  "required": ["message"]
}
```

**Output:**

```json
{
  "commit": { "sha": "abc123..." }
}
```

### Batching Strategy

**Write batching:**

- `put_doc` may carry `commit.batch` identifier
- Server coalesces multiple writes with same batch ID
- Commits once when:
  - Agent calls `git_commit`
  - Idle timeout reached
  - Batch size limit reached

**Example batch workflow:**

```javascript
// Agent writes multiple docs in batch
await put_doc({ type: "task", id: "1", doc: {...}, commit: { batch: "session-42" } });
await put_doc({ type: "task", id: "2", doc: {...}, commit: { batch: "session-42" } });
await put_doc({ type: "task", id: "3", doc: {...}, commit: { batch: "session-42" } });

// Agent commits the batch
await git_commit({ message: "feat(data): batch session-42 (3 docs)" });
```

### Security

**Local operation only:**

- Bind to `127.0.0.1` (localhost)
- No network exposure by default

**Path safety:**

- Sanitize `type/id` to reject traversal attempts
- Validate against allowed character sets
- Reject `..`, slashes, control characters

**Rate limiting:**

- Rate-limit write tools (`put_doc`, `rm_doc`)
- Configurable limits per tool

**Future (network deployment):**

- Follow MCP guidance on tokenized access
- Implement tool metadata and authorization

---

## 8) Git Integration

### Defaults

**Write operations:**

- All writes produce clean, Git-friendly files
- No temporary or binary artifacts in working tree

**Hooks:**

- Provide `.husky/pre-commit` hook template:

  ```bash
  #!/bin/sh
  jsonstore format --all
  ```

- Optional `commit-msg` hook to enforce message format:
  ```bash
  #!/bin/sh
  # Require conventional commit format
  MSG_FILE=$1
  PATTERN="^(feat|fix|chore)\(data\): .+"
  if ! grep -qE "$PATTERN" "$MSG_FILE"; then
    echo "Error: Commit message must match: feat|fix|chore(data): <message>"
    exit 1
  fi
  ```

### Commit Strategies

**Per-write commits:**

```bash
# CLI
jsonstore put task abc123 --data '{...}' --git-commit "feat(data): add task abc123"

# SDK
await store.put(
  { type: "task", id: "abc123" },
  { type: "task", id: "abc123", title: "..." },
  { gitCommit: "feat(data): add task abc123" }
);

# MCP
await put_doc({
  type: "task",
  id: "abc123",
  doc: {...},
  commit: { message: "feat(data): add task abc123" }
});
```

**Batched commits:**

```javascript
// MCP server batching
await put_doc({ type: "task", id: "1", doc: {...}, commit: { batch: "session-42" } });
await put_doc({ type: "task", id: "2", doc: {...}, commit: { batch: "session-42" } });
// ... more writes ...
await git_commit({ message: "feat(data): batch session-42 (N docs)" });
```

### Merging

**Conflict reduction:**

- Deterministic formatting minimizes spurious conflicts
- One file per entity isolates changes

**Merge strategies:**

- Document recommended merge policy (`--no-ff` for feature branches)
- Provide array-sorting helpers if arrays are common
- Use `git merge --strategy-option theirs` for auto-generated fields (timestamps, etc.)

**Post-merge cleanup:**

```bash
# After merge, ensure canonical format
jsonstore format --all
git commit -am "chore(data): normalize formatting post-merge"
```

---

## 9) Validation, Errors, & Edge Cases

### On Write (`put`)

**Must validate:**

- Valid JSON syntax
- Required fields `type` and `id` present
- `type` matches target folder
- `id` matches target filename
- Canonical formatting applied

**Error examples:**

```json
{
  "error": "validation_error",
  "message": "Document type 'user' does not match key type 'task'",
  "code": 1
}
```

### On Query

**Must handle:**

- Unknown operators → clear error message
- Missing fields → treat as `undefined`
- Type mismatches in comparisons → use type precedence
- Empty results → return empty array

**Operator validation:**

```typescript
const VALID_OPERATORS = [
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$exists",
  "$type",
  "$and",
  "$or",
  "$not",
];

function validateOperator(op: string) {
  if (!VALID_OPERATORS.includes(op)) {
    throw new Error(`Unknown operator: ${op}`);
  }
}
```

### Corrupt Files

**On scan:**

- Skip unparseable files with warning
- Log error details
- Continue processing other files

**Recovery:**

```bash
# Attempt to parse and rewrite
jsonstore format --all

# Check results
jsonstore stats
```

### Concurrency

**Recommended approach:**

- Single-writer path through MCP server
- Server serializes write operations

**Alternative (advanced):**

- Per-ID write queue
- File locking (flock/lockfile)
- Retry with exponential backoff

**Example (pseudo-code):**

```typescript
class WriteQueue {
  private queues = new Map<string, Promise<void>>();

  async write(key: Key, fn: () => Promise<void>): Promise<void> {
    const queueKey = `${key.type}/${key.id}`;
    const prev = this.queues.get(queueKey) ?? Promise.resolve();
    const next = prev.then(fn);
    this.queues.set(queueKey, next);
    return next;
  }
}
```

---

## 10) Observability

### SDK Hooks (Optional)

```typescript
export interface ObservabilityHooks {
  onRead?(key: Key, durationMs: number, cached: boolean): void;
  onWrite?(key: Key, durationMs: number, bytes: number): void;
  onDelete?(key: Key, durationMs: number): void;
  onQuery?(spec: QuerySpec, durationMs: number, resultCount: number): void;
}

const store = openStore({
  root: "./data",
  hooks: {
    onQuery: (spec, duration, count) => {
      console.log(`Query: ${duration}ms, ${count} results`);
    },
  },
});
```

### CLI Verbose Mode

```bash
jsonstore query --type task --data '{...}' --verbose

# Output:
# [debug] Scanning directory: data/task/
# [debug] Files found: 142
# [debug] Cache hits: 138, misses: 4
# [debug] Filter matched: 23 documents
# [debug] Sort applied: priority DESC, title ASC
# [debug] Query completed in 45ms
# [23 results...]
```

### MCP Server Logging

**Log format:**

```json
{
  "timestamp": "2025-01-04T08:15:30.123Z",
  "tool": "query",
  "argsShape": { "type": "task", "filter": { "status": "..." } },
  "durationMs": 42,
  "resultCount": 23,
  "cached": true
}
```

**Redaction:**

- Sensitive field values may be redacted
- Log only data shapes, not content
- Configurable per deployment

---

## 11) Configuration

### Store Config File

**Location:** `data/_meta/store.config.json`

**Example:**

```json
{
  "version": "1.0.0",
  "indent": 2,
  "stableKeyOrder": "alpha",
  "indexes": {
    "task": ["status", "projectId", "assignee"],
    "note": ["ownerId", "folder"]
  },
  "git": {
    "enabled": true,
    "autoCommit": false,
    "requireMessage": true
  }
}
```

### Environment Variables

| Variable               | Description              | Default  |
| ---------------------- | ------------------------ | -------- |
| `DATA_ROOT`            | Root directory for store | `./data` |
| `JSONSTORE_INDENT`     | Indentation spaces       | `2`      |
| `JSONSTORE_AUTO_INDEX` | Auto-maintain indexes    | `false`  |
| `JSONSTORE_CACHE_SIZE` | Max cache entries        | `10000`  |

### Per-Type Configuration

**Future enhancement:**

```json
{
  "types": {
    "task": {
      "schema": "./schemas/task.schema.json",
      "indexes": ["status", "projectId"],
      "keyOrder": ["type", "id", "title", "status", "priority"]
    }
  }
}
```

---

## 12) Implementation Plan (Phased)

### Phase 1 — Repository & Tooling ✅

**Completed:**

- [x] Monorepo with pnpm workspaces
- [x] TypeScript configuration (strict mode)
- [x] ESLint + Prettier setup
- [x] Vitest test framework
- [x] CI-ready structure

**Deliverables:**

- `packages/sdk`, `packages/cli`, `packages/server`
- All tests passing
- Type checking enabled

### Phase 2 — Core I/O & Canonicalization

**Tasks:**

- [ ] Implement `stableStringify` with configurable key order
- [ ] Atomic write helpers (temp file + rename + fsync)
- [ ] Document read/parse with error handling
- [ ] Document remove with cleanup
- [ ] Directory structure creation (`init`)

**Tests:**

- [ ] Byte-stable output (golden files)
- [ ] Malformed JSON handling
- [ ] Missing `type/id` validation
- [ ] Path traversal prevention

**Deliverables:**

- `sdk/src/io.ts` with read/write/remove functions
- 100% test coverage on core I/O

### Phase 3 — SDK CRUD & Caching

**Tasks:**

- [ ] Implement `Store.put` with validation
- [ ] Implement `Store.get` with caching
- [ ] Implement `Store.remove`
- [ ] Implement `Store.list`
- [ ] File metadata cache (mtime/size)

**Tests:**

- [ ] Read-after-write consistency
- [ ] Cache invalidation
- [ ] List pagination
- [ ] Concurrent read safety

**Deliverables:**

- Full CRUD operations
- In-memory cache with invalidation

### Phase 4 — Query Engine

**Tasks:**

- [ ] Dot-path getter for nested fields
- [ ] Operator evaluation (all Mango operators)
- [ ] Logical operators ($and, $or, $not)
- [ ] Sort with stable comparator
- [ ] Projection (include/exclude)
- [ ] Pagination (skip/limit)

**Tests:**

- [ ] Operator truth tables
- [ ] Nested field access
- [ ] Multi-field sorting
- [ ] Type precedence in comparisons
- [ ] Edge cases (empty, null, undefined)

**Deliverables:**

- `sdk/src/query.ts` with full Mango support
- Comprehensive test suite (100+ tests)

### Phase 5 — CLI

**Tasks:**

- [ ] Wire all commands to SDK
- [ ] Stdin/stdout/file input handling
- [ ] Pretty output formatting
- [ ] Error handling and exit codes
- [ ] Man pages / help text

**Tests:**

- [ ] Snapshot tests for outputs
- [ ] Error code verification
- [ ] Input validation
- [ ] Pipeline compatibility

**Deliverables:**

- Functional CLI for all operations
- User documentation

### Phase 6 — Indexes (Equality)

**Tasks:**

- [ ] Sidecar index format design
- [ ] `ensureIndex` implementation
- [ ] On-write index maintenance
- [ ] Index rebuild (`reindex`)
- [ ] Consistency checks
- [ ] Query optimizer (use index when available)

**Tests:**

- [ ] Index creation and updates
- [ ] Query performance with indexes
- [ ] Consistency after crashes
- [ ] Large dataset benchmarks

**Deliverables:**

- Optional indexes for 10x+ speedups
- Performance benchmarks

### Phase 7 — MCP Server

**Tasks:**

- [ ] Choose transport (Streamable HTTP recommended)
- [ ] Implement all tool schemas
- [ ] Tool request handlers
- [ ] Batch write coalescing
- [ ] Optional `git_commit` tool
- [ ] Error handling and logging

**Tests:**

- [ ] Integration tests (agent → tools → disk)
- [ ] Batch commit verification
- [ ] Git integration tests
- [ ] Security/sanitization tests

**Deliverables:**

- Functional MCP server
- Tool catalog documentation

### Phase 8 — Documentation & Acceptance

**Tasks:**

- [ ] Complete API reference
- [ ] Query language guide with examples
- [ ] MCP tool catalog
- [ ] Operations runbook
- [ ] Migration guide (if applicable)
- [ ] Acceptance test suite

**Deliverables:**

- Full documentation
- End-to-end acceptance tests
- Production-ready release

---

## 13) Acceptance Criteria & Benchmarks

### Functional Requirements

**Must pass:**

- [x] `init` creates directory structure and config
- [ ] `put/get/rm/list` operate on canonical JSON files
- [ ] **No byte drift** on re-save of unchanged documents
- [ ] Mango queries support all operators
- [ ] SDK, CLI, and MCP server all expose get/put/rm/query/list
- [ ] Indexes are optional but supported
- [ ] Git integration works (manual and automatic commits)

### Performance Benchmarks

**Target metrics (local SSD, M1/M2 Mac or equivalent):**

**Small dataset (1,000 docs, 2-10 KB each):**

- Cold query (no cache): **< 150 ms**
- Warm query (cached): **< 30 ms**
- Indexed equality query: **< 10 ms**

**Medium dataset (10,000 docs, 5 KB average):**

- Cold query (full scan): **< 1.5 seconds**
- Warm query (cached): **< 300 ms**
- Indexed equality query: **< 50 ms**

**Write operations:**

- Single document write: **< 10 ms**
- Batch write (10 docs): **< 100 ms**
- Git commit overhead: **< 200 ms**

### Quality Metrics

**Code coverage:**

- SDK: > 90%
- CLI: > 80%
- MCP Server: > 85%

**Type safety:**

- Zero `any` types in public API
- Full TypeScript strict mode
- No type errors or warnings

---

## 14) Security

### Path Safety

**Validation rules:**

- Constrain all operations under configured `root` directory
- Reject path traversal attempts:
  - `..` in type or id
  - Absolute paths
  - Control characters
  - Leading/trailing dots or slashes

**Implementation:**

```typescript
function sanitizePath(component: string): string {
  if (component.includes("/") || component.includes("\\")) {
    throw new Error("Path component cannot contain slashes");
  }
  if (component === "." || component === "..") {
    throw new Error("Path component cannot be . or ..");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(component)) {
    throw new Error("Invalid characters in path component");
  }
  if (component.startsWith(".") || component.startsWith("-")) {
    throw new Error("Path component cannot start with . or -");
  }
  return component;
}
```

### Network Security

**MCP Server:**

- Bind to `127.0.0.1` only (localhost)
- No external network exposure by default
- Rate limiting on mutating operations:
  - `put_doc`: 100 requests/minute
  - `rm_doc`: 50 requests/minute
  - `query`: 1000 requests/minute

**Future network deployment:**

- Require authentication tokens
- Implement HTTPS/TLS
- Add CORS policies
- Follow MCP security guidelines

### Filesystem Permissions

**Recommendations:**

- Store directory: `chmod 750` (owner read/write/execute, group read/execute)
- Data files: `chmod 640` (owner read/write, group read)
- No world-readable permissions by default

**Credentials:**

- No embedded credentials in documents
- Rely on OS filesystem permissions
- Use environment variables for sensitive config

---

## 15) TypeScript Reference Implementations

### Stable Stringify

```typescript
/**
 * Deterministic JSON stringification with stable key ordering
 */
export function stableStringify(obj: any, indent = 2, order: "alpha" | string[] = "alpha"): string {
  const seen = new WeakSet();

  const sorter = (a: string, b: string): number => {
    if (order === "alpha") {
      return a.localeCompare(b);
    }
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  };

  const normalize = (value: any): any => {
    if (value && typeof value === "object") {
      if (seen.has(value)) {
        throw new Error("Circular reference detected");
      }
      seen.add(value);

      try {
        if (Array.isArray(value)) {
          return value.map(normalize);
        }

        const keys = Object.keys(value).sort(sorter);
        const out: Record<string, any> = {};
        for (const k of keys) {
          out[k] = normalize(value[k]);
        }
        return out;
      } finally {
        seen.delete(value);
      }
    }
    return value;
  };

  return JSON.stringify(normalize(obj), null, indent) + "\n";
}
```

### Mango Query Matcher

```typescript
/**
 * Get nested value using dot-path notation
 */
function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Evaluate a field-level condition
 */
function matchField(val: any, cond: any): boolean {
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    for (const [op, rhs] of Object.entries(cond)) {
      switch (op) {
        case "$eq":
          if (!(val === rhs)) return false;
          break;
        case "$ne":
          if (!(val !== rhs)) return false;
          break;
        case "$in":
          if (!Array.isArray(rhs) || !rhs.includes(val)) return false;
          break;
        case "$nin":
          if (!Array.isArray(rhs) || rhs.includes(val)) return false;
          break;
        case "$gt":
          if (!(val > rhs)) return false;
          break;
        case "$gte":
          if (!(val >= rhs)) return false;
          break;
        case "$lt":
          if (!(val < rhs)) return false;
          break;
        case "$lte":
          if (!(val <= rhs)) return false;
          break;
        case "$exists": {
          const exists = val !== undefined;
          if (exists !== rhs) return false;
          break;
        }
        case "$type": {
          const actualType = Array.isArray(val) ? "array" : typeof val;
          if (actualType !== rhs) return false;
          break;
        }
        default:
          throw new Error(`Unknown operator: ${op}`);
      }
    }
    return true;
  }
  return val === cond;
}

/**
 * Test if a document matches a Mango filter
 */
export function matches(doc: any, filter: Record<string, any>): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  // Logical operators
  if (filter.$and) {
    return filter.$and.every((f: any) => matches(doc, f));
  }
  if (filter.$or) {
    return filter.$or.some((f: any) => matches(doc, f));
  }
  if (filter.$not) {
    return !matches(doc, filter.$not);
  }

  // Field-level conditions
  return Object.entries(filter).every(([key, value]) => matchField(getPath(doc, key), value));
}
```

### Atomic Write

```typescript
import { promises as fs } from "fs";
import { join, dirname } from "path";

/**
 * Atomically write content to a file
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  const dir = dirname(filePath);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Write to temporary file
  await fs.writeFile(tempPath, content, "utf-8");

  // Sync file to disk
  const fd = await fs.open(tempPath, "r+");
  await fd.sync();
  await fd.close();

  // Rename to final location (atomic on POSIX)
  await fs.rename(tempPath, filePath);

  // Sync directory
  const dirFd = await fs.open(dir, "r");
  await dirFd.sync();
  await dirFd.close();
}
```

---

## 16) Repository Layout

```
json-store/
├── packages/
│   ├── sdk/                    # @jsonstore/sdk
│   │   ├── src/
│   │   │   ├── index.ts       # Main exports
│   │   │   ├── types.ts       # Type definitions
│   │   │   ├── store.ts       # Store implementation
│   │   │   ├── format.ts      # Stable stringify
│   │   │   ├── query.ts       # Mango evaluator
│   │   │   ├── validation.ts  # Input validation
│   │   │   ├── io.ts          # File I/O
│   │   │   └── cache.ts       # Caching layer
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                    # jsonstore CLI
│   │   ├── src/
│   │   │   ├── cli.ts         # Main entry point
│   │   │   └── commands/      # Command implementations
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── server/                 # jsonstore-mcp
│       ├── src/
│       │   ├── server.ts      # MCP server
│       │   ├── tools.ts       # Tool definitions
│       │   └── handlers/      # Tool handlers
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   ├── spec.md                # This document
│   ├── api-reference.md       # API documentation
│   ├── query-guide.md         # Query language guide
│   └── mcp-tools.md           # MCP tool catalog
│
├── examples/
│   ├── basic-usage.ts
│   ├── query-examples.ts
│   └── mcp-client.ts
│
├── package.json               # Root package
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

---

## 17) Future Enhancements (Optional)

### Range & Compound Indexes

**Structure:**

```
data/<type>/_indexes/
  range_<field>.json           # B-tree-like structure
  compound_<field1>_<field2>.json
```

**Benefits:**

- 100x+ speedup for range queries
- Multi-field query optimization

### Watch Mode & Change Streams

**SDK API:**

```typescript
const watcher = store.watch((event) => {
  console.log(`${event.type}: ${event.key.type}/${event.key.id}`);
});
```

**MCP streaming:**

- Push change events to connected clients
- Real-time collaboration support

### Schema Validation

**Per-type JSON Schemas:**

```json
{
  "types": {
    "task": {
      "schema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "required": ["type", "id", "title", "status"],
        "properties": {
          "type": { "const": "task" },
          "id": { "type": "string" },
          "title": { "type": "string", "minLength": 1 },
          "status": { "enum": ["open", "ready", "closed"] }
        }
      }
    }
  }
}
```

**Validation:**

- AJV-based validation on write
- Clear error messages for violations

### Pluggable Backends

**Adapter interface:**

```typescript
export interface StorageAdapter {
  read(key: Key): Promise<Document | null>;
  write(key: Key, doc: Document): Promise<void>;
  remove(key: Key): Promise<void>;
  list(type: string): Promise<string[]>;
  scan(type?: string): AsyncIterable<Document>;
}

// Implementations:
// - FileSystemAdapter (default)
// - SQLiteAdapter (JSON1 extension)
// - S3Adapter (for cloud storage)
```

**Benefits:**

- Same SDK API
- Scale to millions of documents
- Cloud deployment options

---

## 18) References & Prior Art

### Research Foundations

This design draws from:

**NeDB:**

- Mongo-like queries in Node
- Optional indexes for performance
- In-memory speedups

**LokiJS:**

- Naive scans work for moderate sizes
- Binary indexes as optional layer
- Client-side query evaluation

**SleekDB:**

- One JSON file per record
- Cached query results
- PHP-based but similar patterns

**TingoDB:**

- Demonstrates what to avoid (monolithic binary formats)
- Not Git-friendly

**MCP (Model Context Protocol):**

- Official OpenAI Agents SDK documentation
- Streamable HTTP and stdio transport modes
- Tool discovery via JSON Schemas

---

## 19) Glossary

| Term                 | Definition                                                      |
| -------------------- | --------------------------------------------------------------- |
| **Canonical format** | Deterministic JSON representation with stable key ordering      |
| **Mango query**      | MongoDB-style query language for filtering documents            |
| **MCP**              | Model Context Protocol - standard for AI agent tool integration |
| **Sidecar index**    | Separate JSON file containing pre-computed lookup data          |
| **Atomic write**     | Write operation that completes fully or not at all              |
| **Type**             | Top-level entity category (e.g., "task", "note")                |
| **Document**         | Single JSON object with required `type` and `id` fields         |

---

## 20) Changelog

| Version | Date       | Changes                                                        |
| ------- | ---------- | -------------------------------------------------------------- |
| 0.1.0   | 2025-01-04 | Initial specification - removed all frontend/viewer references |

---

**End of Specification**
