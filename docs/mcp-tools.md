# MCP Tool Catalog

Complete reference for JSON Store MCP server tools for AI agents.

## Overview

The JSON Store MCP server exposes 6 tools that allow AI agents to interact with the store using the Model Context Protocol (MCP). All tools follow the MCP specification and return structured responses with both text and JSON content.

## Tools

- [get_doc](#get_doc) - Retrieve a document
- [put_doc](#put_doc) - Store or update a document
- [rm_doc](#rm_doc) - Remove a document
- [list_ids](#list_ids) - List document IDs for a type
- [query](#query) - Execute Mango queries
- [ensure_index](#ensure_index) - Create/update an index

## get_doc

Retrieve a document by type and ID.

### Input Schema

```json
{
  "type": "string",     // Required: Entity type (e.g., "task", "user")
  "id": "string"        // Required: Document ID
}
```

### Output

```json
{
  "content": [
    {
      "type": "text",
      "text": "Found document task/task-1"
    },
    {
      "type": "json",
      "json": {
        "doc": {
          "type": "task",
          "id": "task-1",
          "title": "Fix bug",
          "status": "open"
        }
      }
    }
  ]
}
```

**Note**: Returns `null` in `doc` field if document not found.

### Example Usage

```typescript
// Agent uses get_doc tool
const response = await callTool('get_doc', {
  type: 'task',
  id: 'task-1'
});
```

### Error Codes

- `VALIDATION_ERROR` - Invalid type or id
- `DOCUMENT_READ_ERROR` - Failed to read document
- `ETIMEDOUT` - Operation exceeded 2000ms timeout

## put_doc

Store or update a document.

### Input Schema

```json
{
  "type": "string",     // Required: Entity type
  "id": "string",       // Required: Document ID
  "doc": {              // Required: Document object (must include type and id)
    "type": "string",
    "id": "string",
    // ... other fields
  },
  "commit": {           // Optional: Git commit options
    "message": "string",  // Commit message
    "batch": "string"     // Batch identifier for grouping commits
  }
}
```

### Output

```json
{
  "content": [
    {
      "type": "text",
      "text": "Stored task/task-1"
    },
    {
      "type": "json",
      "json": { "ok": true }
    }
  ]
}
```

### Example Usage

```typescript
// Agent creates a new task
await callTool('put_doc', {
  type: 'task',
  id: 'task-1',
  doc: {
    type: 'task',
    id: 'task-1',
    title: 'Fix login bug',
    status: 'open',
    priority: 8
  },
  commit: {
    message: 'feat(task): add task-1'
  }
});
```

### Error Codes

- `VALIDATION_ERROR` - Invalid key or document
- `DOCUMENT_WRITE_ERROR` - Failed to write document
- `ETIMEDOUT` - Operation exceeded 5000ms timeout

## rm_doc

Remove a document. Operation is idempotent (no error if document doesn't exist).

### Input Schema

```json
{
  "type": "string",     // Required: Entity type
  "id": "string",       // Required: Document ID
  "commit": {           // Optional: Git commit options
    "message": "string"   // Commit message
  }
}
```

### Output

```json
{
  "content": [
    {
      "type": "text",
      "text": "Removed task/task-1"
    },
    {
      "type": "json",
      "json": { "ok": true }
    }
  ]
}
```

### Example Usage

```typescript
// Agent removes a completed task
await callTool('rm_doc', {
  type: 'task',
  id: 'task-1',
  commit: {
    message: 'chore(task): remove completed task'
  }
});
```

### Error Codes

- `VALIDATION_ERROR` - Invalid type or id
- `ETIMEDOUT` - Operation exceeded 5000ms timeout

## list_ids

List all document IDs for a given type. Results are capped at 5000 documents.

### Input Schema

```json
{
  "type": "string"      // Required: Entity type to list
}
```

### Output

```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 3 documents of type task"
    },
    {
      "type": "json",
      "json": {
        "ids": ["task-1", "task-2", "task-3"],
        "count": 3
      }
    }
  ]
}
```

### Example Usage

```typescript
// Agent lists all tasks
const response = await callTool('list_ids', {
  type: 'task'
});

const { ids, count } = response.content[1].json;
console.log(`Found ${count} tasks`);
```

### Error Codes

- `VALIDATION_ERROR` - Invalid type name
- `ETIMEDOUT` - Operation exceeded 2000ms timeout

## query

Execute a Mango query to find matching documents.

### Input Schema

```json
{
  "type": "string",       // Optional: Restrict to specific type
  "filter": {             // Required: Mango filter object
    // Supports: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte,
    //           $exists, $type, $and, $or, $not
  },
  "projection": {         // Optional: Fields to include (1) or exclude (0)
    "field": 1
  },
  "sort": {               // Optional: Sort specification
    "field": 1            // 1 = ascending, -1 = descending
  },
  "limit": 100,           // Optional: Max results (default: 100, max: 1000)
  "skip": 0               // Optional: Skip results (for pagination, max: 10000)
}
```

### Output

```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 2 matching documents"
    },
    {
      "type": "json",
      "json": {
        "results": [
          {
            "type": "task",
            "id": "task-1",
            "title": "Fix bug",
            "status": "open",
            "priority": 8
          },
          {
            "type": "task",
            "id": "task-2",
            "title": "Add feature",
            "status": "open",
            "priority": 9
          }
        ],
        "count": 2
      }
    }
  ]
}
```

### Example Usage

```typescript
// Agent finds high-priority open tasks
const response = await callTool('query', {
  type: 'task',
  filter: {
    $and: [
      { status: { $eq: 'open' } },
      { priority: { $gte: 8 } }
    ]
  },
  sort: { priority: -1 },
  limit: 10
});

const { results, count } = response.content[1].json;
```

### Error Codes

- `VALIDATION_ERROR` - Invalid query specification
- `ETIMEDOUT` - Operation exceeded 5000ms timeout

## ensure_index

Create or update an equality index for fast lookups on a field. Operation is idempotent.

### Input Schema

```json
{
  "type": "string",     // Required: Entity type
  "field": "string"     // Required: Field name (supports dot notation)
}
```

### Output

```json
{
  "content": [
    {
      "type": "text",
      "text": "Index created on task.status"
    },
    {
      "type": "json",
      "json": { "ok": true }
    }
  ]
}
```

### Example Usage

```typescript
// Agent creates indexes for frequently queried fields
await callTool('ensure_index', {
  type: 'task',
  field: 'status'
});

await callTool('ensure_index', {
  type: 'task',
  field: 'priority'
});

// Index on nested field
await callTool('ensure_index', {
  type: 'task',
  field: 'assignee.id'
});
```

### Error Codes

- `VALIDATION_ERROR` - Invalid type or field name
- `ETIMEDOUT` - Operation exceeded 5000ms timeout

## Error Handling

All tools return structured errors following this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

### Common Error Codes

- `VALIDATION_ERROR` - Invalid input parameters
- `NOT_FOUND` - Document not found (only for non-idempotent operations)
- `DOCUMENT_READ_ERROR` - Failed to read document
- `DOCUMENT_WRITE_ERROR` - Failed to write document
- `ETIMEDOUT` - Operation exceeded timeout

## Agent Usage Examples

### Create and Query Tasks

```
User: Create a new task for fixing the login bug with high priority.

Agent: I'll create a new task for you.

[Uses put_doc tool]
{
  "type": "task",
  "id": "fix-login-bug",
  "doc": {
    "type": "task",
    "id": "fix-login-bug",
    "title": "Fix login bug",
    "description": "Users unable to login with email",
    "status": "open",
    "priority": 8,
    "createdAt": "2025-01-04T12:00:00Z"
  }
}

Agent: Task created successfully.

---

User: Show me all high-priority open tasks.

Agent: I'll find all high-priority open tasks.

[Uses query tool]
{
  "type": "task",
  "filter": {
    "$and": [
      {"status": {"$eq": "open"}},
      {"priority": {"$gte": 8}}
    ]
  },
  "sort": {"priority": -1}
}

Agent: Found 2 high-priority open tasks:
1. Fix login bug (priority: 8)
2. Security audit (priority: 9)
```

### Manage User Data

```
User: Add a new user with email alice@example.com.

Agent: I'll create the user document.

[Uses put_doc tool]
{
  "type": "user",
  "id": "alice",
  "doc": {
    "type": "user",
    "id": "alice",
    "email": "alice@example.com",
    "name": "Alice Smith",
    "status": "active",
    "createdAt": "2025-01-04T12:00:00Z"
  },
  "commit": {
    "message": "feat(user): add alice"
  }
}

---

User: Find all active users.

Agent: I'll query for active users.

[Uses query tool]
{
  "type": "user",
  "filter": {"status": {"$eq": "active"}},
  "projection": {"id": 1, "email": 1, "name": 1}
}

Agent: Found 5 active users.
```

### Optimize Queries with Indexes

```
User: The task queries are slow. Can you optimize them?

Agent: I'll create indexes on the frequently queried fields.

[Uses ensure_index tool]
{
  "type": "task",
  "field": "status"
}

[Uses ensure_index tool]
{
  "type": "task",
  "field": "priority"
}

Agent: Created indexes on task.status and task.priority.
Queries filtering on these fields will now be much faster.
```

## Server Configuration

### Running the MCP Server

```bash
# Start in stdio mode (for MCP clients)
pnpm --filter @jsonstore/server start

# Development mode with watch
pnpm --filter @jsonstore/server dev
```

### Environment Variables

- `JSONSTORE_ROOT` - Data directory path (required)
- `JSONSTORE_CACHE_SIZE` - Cache size (default: 10000, 0 to disable)
- `JSONSTORE_DEBUG` - Enable debug logging (set to any value)

### Example Server Configuration

```json
{
  "mcpServers": {
    "jsonstore": {
      "command": "pnpm",
      "args": ["--filter", "@jsonstore/server", "start"],
      "env": {
        "JSONSTORE_ROOT": "./data"
      }
    }
  }
}
```

## Performance Guidelines

### Timeouts

Each tool has a timeout to prevent hanging operations:

- `get_doc`: 2000ms
- `put_doc`: 5000ms
- `rm_doc`: 5000ms
- `list_ids`: 2000ms
- `query`: 5000ms
- `ensure_index`: 5000ms

### Limits

- `list_ids`: Maximum 5000 document IDs returned
- `query`: Maximum limit of 1000 results (default: 100)
- `query`: Maximum skip of 10000 for pagination

### Best Practices

1. **Always specify type in queries** - Reduces scan scope
2. **Use indexes for frequently filtered fields** - Dramatically improves query speed
3. **Set reasonable limits** - Avoid returning excessive data
4. **Batch related operations** - Use commit batching for multiple writes
5. **Project only needed fields** - Reduces response size

## Integration Examples

### With Claude Desktop

```json
{
  "mcpServers": {
    "jsonstore": {
      "command": "node",
      "args": ["/path/to/json-store/packages/server/dist/server.js"],
      "env": {
        "JSONSTORE_ROOT": "/path/to/data"
      }
    }
  }
}
```

### With Custom MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'pnpm',
  args: ['--filter', '@jsonstore/server', 'start'],
  env: { JSONSTORE_ROOT: './data' }
});

const client = new Client({ name: 'my-app', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Call tools
const result = await client.callTool({
  name: 'get_doc',
  arguments: { type: 'task', id: 'task-1' }
});
```

## Observability

The MCP server includes built-in observability:

### Logging

- Tool calls with duration and success/failure
- Error details with stack traces
- Performance warnings for slow operations

### Metrics

- Tool execution count and duration
- Success/failure rates
- Error code distribution

Access logs via console output when running the server.
