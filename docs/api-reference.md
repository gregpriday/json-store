# API Reference

Complete TypeScript API documentation for JSON Store SDK.

## Table of Contents

- [openStore()](#openstore)
- [Store Interface](#store-interface)
  - [put()](#put)
  - [get()](#get)
  - [remove()](#remove)
  - [list()](#list)
  - [query()](#query)
  - [ensureIndex()](#ensureindex)
  - [stats()](#stats)
  - [format()](#format)
- [Types](#types)
  - [StoreOptions](#storeoptions)
  - [Key](#key)
  - [Document](#document)
  - [QuerySpec](#queryspec)
  - [Filter](#filter)
  - [Sort](#sort)
  - [Projection](#projection)

## openStore()

Opens a JSON Store instance with the specified configuration.

### Signature

```typescript
function openStore(options: StoreOptions): Store
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options` | `StoreOptions` | Yes | Store configuration |
| `options.root` | `string` | Yes | Root directory for data storage |
| `options.indent` | `number` | No | JSON indentation spaces (default: 2) |
| `options.stableKeyOrder` | `'alpha' \| string[]` | No | Key ordering strategy (default: 'alpha') |
| `options.watch` | `boolean` | No | Enable file watching (default: false) |
| `options.enableIndexes` | `boolean` | No | Enable equality indexes (default: false) |
| `options.indexes` | `Record<string, string[]>` | No | Field indexes per type |
| `options.formatConcurrency` | `number` | No | Max concurrency for format ops (default: 16, range: 1-64) |

### Returns

`Store` - Store instance ready for operations

### Example

```typescript
import { openStore } from '@jsonstore/sdk';

// Basic store with defaults
const store = openStore({ root: './data' });
```

**Advanced configuration:**

```typescript
import { openStore } from '@jsonstore/sdk';

// Store with custom configuration
const storeWithIndexes = openStore({
  root: './data',
  indent: 2,
  stableKeyOrder: 'alpha',
  enableIndexes: true,
  indexes: {
    task: ['status', 'priority'],
    user: ['email']
  }
});
```

## Store Interface

The main interface for interacting with the JSON Store.

### put()

Store or update a document.

#### Signature

```typescript
async put(key: Key, doc: Document, opts?: WriteOptions): Promise<void>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `Key` | Yes | Document identifier (type and id) |
| `doc` | `Document` | Yes | Document data (must include matching type and id fields) |
| `opts` | `WriteOptions` | No | Optional write options |
| `opts.gitCommit` | `string` | No | Git commit message for this change |

#### Returns

`Promise<void>` - Resolves when write completes

#### Throws

- `ValidationError` - If key or document is invalid
- `DocumentWriteError` - If write operation fails

#### Behavior

- Atomically writes document to disk with deterministic formatting
- Skips write if document content is unchanged (no-op optimization)
- Invalidates cache entry
- Updates indexes if enabled
- Optionally commits to git (non-blocking, errors logged)

#### Example

```typescript
// Basic put
await store.put(
  { type: 'task', id: 'task-1' },
  {
    type: 'task',
    id: 'task-1',
    title: 'Fix login bug',
    status: 'open',
    priority: 8
  }
);

// Put with git commit
await store.put(
  { type: 'task', id: 'task-1' },
  { type: 'task', id: 'task-1', title: 'Updated task', status: 'closed' },
  { gitCommit: 'feat(task): close task-1' }
);
```

### get()

Retrieve a document by key.

#### Signature

```typescript
async get(key: Key): Promise<Document | null>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `Key` | Yes | Document identifier (type and id) |

#### Returns

`Promise<Document | null>` - Document if found, null if not found

#### Throws

- `ValidationError` - If key is invalid
- `DocumentReadError` - If read operation fails (excluding ENOENT)

#### Behavior

- Returns from cache if available and valid (validated by mtime and size)
- Reads from disk on cache miss
- Implements TOCTOU guard by re-checking file stats after read
- Retries up to 3 times if file changes during read
- Validates document structure matches key

#### Example

```typescript
const doc = await store.get({ type: 'task', id: 'task-1' });

if (doc) {
  console.log(`Title: ${doc.title}`);
  console.log(`Status: ${doc.status}`);
} else {
  console.log('Document not found');
}
```

### remove()

Remove a document.

#### Signature

```typescript
async remove(key: Key, opts?: RemoveOptions): Promise<void>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | `Key` | Yes | Document identifier (type and id) |
| `opts` | `RemoveOptions` | No | Optional remove options |
| `opts.gitCommit` | `string` | No | Git commit message for this change |

#### Returns

`Promise<void>` - Resolves when remove completes

#### Throws

- `ValidationError` - If key is invalid

#### Behavior

- Deletes document file from disk
- Operation is idempotent (no error if document doesn't exist)
- Invalidates cache entry
- Updates indexes if enabled
- Optionally commits to git (non-blocking, errors logged)

#### Example

```typescript
// Basic remove
await store.remove({ type: 'task', id: 'task-1' });

// Remove with git commit
await store.remove(
  { type: 'task', id: 'task-1' },
  { gitCommit: 'chore(task): remove completed task' }
);
```

### list()

List all document IDs for a given type.

#### Signature

```typescript
async list(type: string): Promise<string[]>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | Yes | Entity type to list |

#### Returns

`Promise<string[]>` - Sorted array of document IDs

#### Throws

- `ValidationError` - If type name is invalid

#### Behavior

- Returns only document IDs (not full documents)
- Results are sorted alphabetically
- Does not load document content (efficient for large types)
- Returns empty array if type directory doesn't exist

#### Example

```typescript
const ids = await store.list('task');
console.log(`Found ${ids.length} tasks`);

for (const id of ids) {
  console.log(`- ${id}`);
}
```

### query()

Execute a Mango query to find matching documents.

#### Signature

```typescript
async query(spec: QuerySpec): Promise<Document[]>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spec` | `QuerySpec` | Yes | Query specification |
| `spec.type` | `string` | No | Restrict query to specific type |
| `spec.filter` | `Filter` | Yes | Filter conditions using Mango operators |
| `spec.projection` | `Projection` | No | Fields to include/exclude |
| `spec.sort` | `Sort` | No | Sort order for results |
| `spec.limit` | `number` | No | Maximum number of results |
| `spec.skip` | `number` | No | Number of results to skip (for pagination) |

#### Returns

`Promise<Document[]>` - Array of matching documents (may be empty)

#### Throws

- `Error` - If query specification is invalid

#### Behavior

- Supports all Mango operators: `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$exists`, `$type`, `$and`, `$or`, `$not`
- Uses indexes when available for equality filters
- Implements fast path for simple ID-based filters
- Filters during scan to reduce memory usage
- Returns empty array if no matches found

#### Example

```typescript
// Find open high-priority tasks
const results = await store.query({
  type: 'task',
  filter: {
    $and: [
      { status: { $eq: 'open' } },
      { priority: { $gte: 8 } }
    ]
  },
  sort: { priority: -1, createdAt: -1 },
  limit: 10
});

// Query with projection
const summaries = await store.query({
  type: 'task',
  filter: { status: 'open' },
  projection: { id: 1, title: 1, priority: 1 }
});

// Paginated query
const page2 = await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { createdAt: -1 },
  limit: 20,
  skip: 20
});
```

### ensureIndex()

Create or rebuild an equality index for fast lookups.

#### Signature

```typescript
async ensureIndex(type: string, field: string): Promise<void>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | Yes | Entity type to index |
| `field` | `string` | Yes | Field name to index (supports dot paths) |

#### Returns

`Promise<void>` - Resolves when index is created/updated

#### Throws

- `ValidationError` - If type or field name is invalid

#### Behavior

- Creates an inverted index: `{ "value": ["id1", "id2"] }`
- Index is stored as sidecar JSON file in `_indexes/` directory
- Operation is idempotent (safe to call multiple times)
- Rebuilds entire index on each call
- Automatically maintained on subsequent put/remove operations

#### Example

```typescript
// Create index on frequently queried fields
await store.ensureIndex('task', 'status');
await store.ensureIndex('task', 'priority');
await store.ensureIndex('user', 'email');

// Index on nested field
await store.ensureIndex('task', 'assignee.id');
```

### stats()

Get statistics about documents in the store.

#### Signature

```typescript
async stats(type?: string): Promise<StoreStats>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `string` | No | Entity type to get stats for (all types if omitted) |

#### Returns

`Promise<StoreStats>` - Statistics object with document counts and sizes

#### Example

```typescript
// Stats for all types
const allStats = await store.stats();
console.log(`Total documents: ${allStats.count}`);
console.log(`Total size: ${allStats.bytes} bytes`);

// Stats for specific type
const taskStats = await store.stats('task');
console.log(`Tasks: ${taskStats.count}`);
```

### format()

Format documents to ensure consistent formatting.

#### Signature

```typescript
async format(target?: FormatTarget, opts?: FormatOptions): Promise<number>
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | `FormatTarget` | No | Documents to format (specific key, type, or 'all') |
| `opts` | `FormatOptions` | No | Format options |
| `opts.dryRun` | `boolean` | No | Check formatting without writing changes |
| `opts.failFast` | `boolean` | No | Stop at the first formatting error |

#### Returns

`Promise<number>` - Resolves with the number of documents reformatted

#### Behavior

- Rewrites documents with deterministic formatting
- Uses stable key ordering and consistent indentation
- Respects formatConcurrency setting to avoid overwhelming filesystem

#### Example

```typescript
// Format all documents
await store.format();

// Format specific type
await store.format({ type: 'task' });

// Format specific document
await store.format({ type: 'task', id: 'task-1' });
```

## Types

### StoreOptions

Configuration options for opening a store.

```typescript
interface StoreOptions {
  /** Root directory for the data store (e.g., ./data) */
  root: string;

  /** Number of spaces for JSON indentation (default: 2) */
  indent?: number;

  /** Key ordering strategy: "alpha" for alphabetical, or array for explicit order */
  stableKeyOrder?: "alpha" | string[];

  /** Enable file system watching to refresh caches (optional) */
  watch?: boolean;

  /** Enable equality indexes for fast query execution (default: false) */
  enableIndexes?: boolean;

  /** Fields to index per type: { type: [field1, field2] } */
  indexes?: Record<string, string[]>;

  /** Maximum concurrency for format operations (default: 16, range: 1-64) */
  formatConcurrency?: number;
}
```

### Key

Document identifier consisting of type and id.

```typescript
interface Key {
  /** Entity type (maps to folder name) */
  type: string;

  /** Entity ID (maps to filename without .json) */
  id: string;
}
```

**Constraints:**

- Type and ID must be non-empty, URI-safe strings
- Must not contain: `/`, `\`, `..`, or path traversal sequences
- Must not be absolute paths

### Document

Base document structure. All documents must include type and id fields matching their key.

```typescript
type Document = Record<string, unknown> & {
  type: string;
  id: string;
};
```

**Example:**

```typescript
{
  type: 'task',
  id: 'task-1',
  title: 'Fix bug',
  status: 'open',
  priority: 8,
  tags: ['urgent', 'bug']
}
```

### QuerySpec

Complete query specification for finding documents.

```typescript
interface QuerySpec {
  /** Restrict query to a specific type (optional) */
  type?: string;

  /** Filter conditions using Mango query language */
  filter: Filter;

  /** Fields to include/exclude in results (optional) */
  projection?: Projection;

  /** Sort order for results (optional) */
  sort?: Sort;

  /** Maximum number of results to return (optional) */
  limit?: number;

  /** Number of results to skip (for pagination, optional) */
  skip?: number;
}
```

### Filter

Filter object for Mango queries. Can be field conditions, logical operators, or combinations.

```typescript
type Filter = Record<string, any> | LogicalOperator;

type LogicalOperator =
  | { $and: Filter[] }
  | { $or: Filter[] }
  | { $not: Filter };
```

**Field Operators:**

```typescript
type FieldOperator =
  | { $eq: any }      // Equals
  | { $ne: any }      // Not equals
  | { $in: any[] }    // In array
  | { $nin: any[] }   // Not in array
  | { $gt: any }      // Greater than
  | { $gte: any }     // Greater than or equal
  | { $lt: any }      // Less than
  | { $lte: any }     // Less than or equal
  | { $exists: boolean }  // Field exists
  | { $type: string };    // Type check
```

**Example:**

```typescript
{
  $and: [
    { status: { $in: ['open', 'ready'] } },
    { priority: { $gte: 5 } },
    { assignee: { $exists: true } }
  ]
}
```

### Sort

Sort specification. `1` for ascending, `-1` for descending.

```typescript
type Sort = Record<string, 1 | -1>;
```

**Example:**

```typescript
{
  priority: -1,      // Sort by priority descending
  createdAt: -1,     // Then by createdAt descending
  title: 1           // Then by title ascending
}
```

### Projection

Projection specification. `1` to include field, `0` to exclude.

```typescript
type Projection = Record<string, 0 | 1>;
```

**Example:**

```typescript
{
  id: 1,
  title: 1,
  priority: 1
  // All other fields excluded
}
```

## Error Types

JSON Store uses specific error classes for different failure scenarios:

- **DocumentNotFoundError** - Document does not exist (only in non-idempotent operations)
- **DocumentReadError** - Failed to read document file
- **DocumentWriteError** - Failed to write document file
- **DocumentRemoveError** - Failed to remove document file
- **DirectoryError** - Directory operation failed
- **ListFilesError** - Failed to enumerate files in a directory
- **FormatError** - Failed to format document

All SDK errors include a `code` field for programmatic handling. Input validation failures throw standard `Error` instances with descriptive messages.
