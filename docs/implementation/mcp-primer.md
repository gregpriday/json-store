# Model Context Protocol (MCP) Primer for JSON Store

This guide explains MCP concepts and how to implement the JSON Store MCP server.

## What is MCP?

**Model Context Protocol (MCP)** is a standard way for AI agents to interact with external tools and data sources. Think of it as an API that AI models can call to perform actions.

### Key Concepts

| Concept       | Description                   | JSON Store Example            |
| ------------- | ----------------------------- | ----------------------------- |
| **Server**    | Exposes tools to AI agents    | JSON Store MCP server         |
| **Client**    | AI agent that uses tools      | Claude Desktop, custom agent  |
| **Tool**      | A function the agent can call | `get_doc`, `put_doc`, `query` |
| **Transport** | How client/server communicate | stdio (stdin/stdout)          |
| **Schema**    | Defines tool inputs/outputs   | Zod schemas for validation    |

## Why MCP for JSON Store?

MCP allows AI agents to:

- **Create documents**: "Create a task for fixing the login bug"
- **Query data**: "Show me all high-priority open tasks"
- **Update documents**: "Mark task-123 as complete"
- **Analyze data**: "Summarize all tasks from this week"

## MCP Architecture

```
┌─────────────────┐         ┌──────────────────┐
│   AI Agent      │         │  JSON Store      │
│  (Claude, etc)  │         │   MCP Server     │
│                 │         │                  │
│  Sends:         │────────▶│  Receives:       │
│  Tool Calls     │  stdio  │  Tool Calls      │
│                 │         │                  │
│  Receives:      │◀────────│  Sends:          │
│  Tool Results   │         │  Tool Results    │
└─────────────────┘         └──────────────────┘
                                     │
                                     ▼
                            ┌──────────────────┐
                            │   JSON Store     │
                            │   SDK (./data)   │
                            └──────────────────┘
```

## Transport: stdio

**stdio** = Standard Input/Output

- **Server reads from**: `process.stdin` (JSON-RPC messages)
- **Server writes to**: `process.stdout` (JSON-RPC responses)
- **Server logs to**: `process.stderr` (debugging, don't pollute stdout!)

### Why stdio?

- ✅ Simple to implement
- ✅ Works locally (no network required)
- ✅ Secure (localhost only)
- ✅ Perfect for Claude Desktop integration
- ✅ Easy to test with pipes

## JSON Store MCP Tools

Our server exposes 6 tools:

### 1. get_doc

Retrieve a document by type and ID.

```typescript
// Input
{
  type: "task",
  id: "abc123"
}

// Output
{
  doc: {
    type: "task",
    id: "abc123",
    title: "Fix bug",
    status: "open"
  }
}
```

### 2. put_doc

Create or update a document.

```typescript
// Input
{
  type: "task",
  id: "abc123",
  doc: {
    type: "task",
    id: "abc123",
    title: "Fix bug",
    status: "open",
    priority: 5
  },
  commit: {
    message: "feat(data): add task abc123" // optional
  }
}

// Output
{
  ok: true
}
```

### 3. rm_doc

Delete a document.

```typescript
// Input
{
  type: "task",
  id: "abc123"
}

// Output
{
  ok: true
}
```

### 4. list_ids

List all document IDs for a type.

```typescript
// Input
{
  type: "task";
}

// Output
{
  ids: ["task-1", "task-2", "task-3"];
}
```

### 5. query

Execute a Mango query.

```typescript
// Input
{
  type: "task",
  filter: {
    status: { $eq: "open" },
    priority: { $gte: 5 }
  },
  sort: { priority: -1 },
  limit: 10
}

// Output
{
  results: [
    { type: "task", id: "task-1", title: "...", priority: 8 },
    { type: "task", id: "task-2", title: "...", priority: 7 }
  ]
}
```

### 6. ensure_index

Create an equality index for fast queries.

```typescript
// Input
{
  type: "task",
  field: "status"
}

// Output
{
  ok: true
}
```

## Implementation with @modelcontextprotocol/sdk

### 1. Install SDK

```bash
pnpm add @modelcontextprotocol/sdk zod
```

### 2. Create Server

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create server instance
const server = new McpServer({
  name: "jsonstore-mcp",
  version: "0.1.0",
});
```

### 3. Register Tools

```typescript
// Define input schema with Zod
const getDocSchema = z.object({
  type: z.string().describe("Entity type"),
  id: z.string().describe("Entity ID"),
});

// Register tool
server.registerTool(
  "get_doc", // Tool name
  {
    title: "Get Document",
    description: "Retrieve a document by type and ID",
    inputSchema: getDocSchema, // Zod schema for validation
    outputSchema: z.object({
      doc: z.record(z.any()).nullable(),
    }),
  },
  async ({ type, id }) => {
    // Handler function
    const doc = await store.get({ type, id });

    return {
      content: [
        {
          // Human-readable text
          type: "text",
          text: doc ? JSON.stringify(doc, null, 2) : "Document not found",
        },
      ],
      structuredContent: { doc }, // Structured data for agent
    };
  }
);
```

### 4. Connect Transport

```typescript
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (not stdout!)
  console.error("JSON Store MCP server running on stdio");
}

main();
```

## Tool Response Format

Each tool handler returns:

```typescript
{
  content: [                      // Array of content blocks
    {
      type: 'text',              // Content type
      text: 'Human-readable message'
    }
  ],
  structuredContent: {           // Structured data for agent
    // Return values here
  }
}
```

## Testing the Server

### 1. Manual Test with stdio

```bash
# Start server
node dist/server.js

# In another terminal, send JSON-RPC request
echo '{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_doc",
    "arguments": {
      "type": "task",
      "id": "test-1"
    }
  },
  "id": 1
}' | node dist/server.js
```

### 2. Test with MCP Inspector

```bash
# Install MCP inspector
npm install -g @modelcontextprotocol/inspector

# Run server through inspector
npx @modelcontextprotocol/inspector node dist/server.js
```

Opens a web UI to test tools interactively.

### 3. Integration with Claude Desktop

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jsonstore": {
      "command": "node",
      "args": ["/absolute/path/to/json-store/packages/server/dist/server.js"],
      "env": {
        "DATA_ROOT": "/absolute/path/to/data"
      }
    }
  }
}
```

Restart Claude Desktop. The tools will appear in the tool panel.

## Agent Usage Examples

### Example 1: Create Task

**User**: "Create a task to fix the login bug with high priority"

**Agent thinks**:

```
I'll use the put_doc tool to create a new task document.
```

**Agent calls**:

```json
{
  "tool": "put_doc",
  "arguments": {
    "type": "task",
    "id": "fix-login-bug",
    "doc": {
      "type": "task",
      "id": "fix-login-bug",
      "title": "Fix login bug",
      "description": "Users unable to login with email",
      "status": "open",
      "priority": 8,
      "createdAt": "2025-01-04T10:00:00Z"
    }
  }
}
```

**Server responds**:

```json
{
  "ok": true
}
```

**Agent says**: "I've created task 'fix-login-bug' with high priority (8)."

### Example 2: Query Tasks

**User**: "Show me all high-priority open tasks"

**Agent calls**:

```json
{
  "tool": "query",
  "arguments": {
    "type": "task",
    "filter": {
      "$and": [{ "status": { "$eq": "open" } }, { "priority": { "$gte": 7 } }]
    },
    "sort": { "priority": -1 }
  }
}
```

**Server responds**:

```json
{
  "results": [
    {
      "type": "task",
      "id": "fix-login-bug",
      "title": "Fix login bug",
      "priority": 8,
      "status": "open"
    },
    {
      "type": "task",
      "id": "security-update",
      "title": "Apply security patch",
      "priority": 7,
      "status": "open"
    }
  ]
}
```

**Agent says**: "Found 2 high-priority open tasks:

1. Fix login bug (priority 8)
2. Apply security patch (priority 7)"

## Error Handling

### Validation Errors (Zod)

```typescript
server.registerTool(
  "get_doc",
  {
    inputSchema: z.object({
      type: z.string().min(1), // Will throw if empty
      id: z.string().min(1),
    }),
  },
  async (args) => {
    // Zod validates automatically before this runs
    // If validation fails, error is returned to agent
  }
);
```

### Runtime Errors

```typescript
server.registerTool(
  "get_doc",
  {
    /* ... */
  },
  async ({ type, id }) => {
    try {
      const doc = await store.get({ type, id });
      return {
        /* success */
      };
    } catch (error) {
      // Error is caught and returned to agent
      throw new Error(`Failed to get document: ${error.message}`);
    }
  }
);
```

## Best Practices

### 1. Logging

```typescript
// ✅ Correct: Log to stderr
console.error("Server started");
console.error(`Tool called: ${toolName}`);

// ❌ Wrong: Log to stdout (breaks protocol!)
console.log("Server started"); // NO!
```

### 2. Schema Validation

```typescript
// ✅ Use Zod for validation
const schema = z.object({
  type: z.string().min(1),
  id: z.string().regex(/^[A-Za-z0-9_.-]+$/), // Validate format
});

// ❌ Don't validate manually
if (!type || !id) throw new Error("..."); // Let Zod handle this
```

### 3. Error Messages

```typescript
// ✅ Clear, actionable errors
throw new Error("Document not found: task/abc123");
throw new Error("Invalid type: must match [A-Za-z0-9_.-]+");

// ❌ Vague errors
throw new Error("Error");
throw new Error("Something went wrong");
```

### 4. Response Format

```typescript
// ✅ Always provide both text and structured content
return {
  content: [{ type: "text", text: "Document created successfully" }],
  structuredContent: { ok: true, id: "task-1" },
};

// ❌ Missing content
return { structuredContent: { ok: true } }; // Agent can't explain to user
```

## Debugging

### Enable Debug Logging

```typescript
// Add verbose logging
console.error(`[DEBUG] Tool called: ${toolName}`);
console.error(`[DEBUG] Arguments: ${JSON.stringify(args)}`);
console.error(`[DEBUG] Result: ${JSON.stringify(result)}`);
```

### Check Server Logs

Claude Desktop logs MCP servers to:

```
~/Library/Logs/Claude/mcp*.log
```

## Common Issues

### Issue: Server not appearing in Claude Desktop

**Solution**:

1. Check config path is absolute
2. Check command is correct (node)
3. Restart Claude Desktop
4. Check logs for errors

### Issue: "stdout is not a protocol channel"

**Solution**: You're using `console.log` instead of `console.error`

### Issue: Tool validation fails

**Solution**: Check Zod schema matches your input exactly

## Resources

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Claude Desktop Integration](https://docs.anthropic.com/claude/docs)
- [Zod Documentation](https://zod.dev/)
