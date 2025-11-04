/**
 * MCP tool definitions for JSON Store
 */

/**
 * Tool schemas following MCP specification
 * Each tool has a name, description, and JSON Schema for input
 */

export const tools = [
  {
    name: "get_doc",
    description: "Retrieve a document by type and ID",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Entity type (e.g., 'task', 'project')",
        },
        id: {
          type: "string",
          description: "Document ID",
        },
      },
      required: ["type", "id"],
    },
  },
  {
    name: "put_doc",
    description: "Store or update a document",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Entity type (e.g., 'task', 'project')",
        },
        id: {
          type: "string",
          description: "Document ID",
        },
        doc: {
          type: "object",
          description: "Document to store (must include type and id fields)",
        },
        commit: {
          type: "object",
          description: "Optional git commit options",
          properties: {
            message: {
              type: "string",
              description: "Commit message",
            },
            batch: {
              type: "string",
              description: "Batch identifier for grouping multiple commits",
            },
          },
        },
      },
      required: ["type", "id", "doc"],
    },
  },
  {
    name: "rm_doc",
    description: "Remove a document",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Entity type",
        },
        id: {
          type: "string",
          description: "Document ID",
        },
        commit: {
          type: "object",
          description: "Optional git commit options",
          properties: {
            message: {
              type: "string",
              description: "Commit message",
            },
          },
        },
      },
      required: ["type", "id"],
    },
  },
  {
    name: "list_ids",
    description: "List all document IDs for a given type",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Entity type to list",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "query",
    description: "Query documents using Mango query language",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Optional entity type to restrict query",
        },
        filter: {
          type: "object",
          description:
            "Mango filter object (supports $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $and, $or, $not)",
        },
        projection: {
          type: "object",
          description: "Fields to include (1) or exclude (0)",
        },
        sort: {
          type: "object",
          description: "Sort specification (1 for ascending, -1 for descending)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
        },
        skip: {
          type: "number",
          description: "Number of results to skip (for pagination)",
        },
      },
      required: ["filter"],
    },
  },
  {
    name: "ensure_index",
    description: "Create or update an equality index for fast lookups on a field",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Entity type",
        },
        field: {
          type: "string",
          description: "Field name to index",
        },
      },
      required: ["type", "field"],
    },
  },
  {
    name: "git_commit",
    description: "Commit staged changes to git (optional tool for explicit control)",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Commit message",
        },
        add: {
          type: "array",
          items: { type: "string" },
          description: "Optional array of file paths to stage before committing",
        },
      },
      required: ["message"],
    },
  },
];
