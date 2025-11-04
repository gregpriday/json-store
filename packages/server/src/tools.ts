/**
 * MCP tool implementations for JSON Store
 * All tools follow MCP spec: return content array with text and json items
 */

import {
  GetDocInputSchema,
  PutDocInputSchema,
  RemoveDocInputSchema,
  ListIdsInputSchema,
  QueryInputSchema,
  EnsureIndexInputSchema,
} from "./schemas.js";
import { jsonStoreService } from "./service/jsonstore.js";
import { logger } from "./observability/logger.js";
import { recordToolExecution } from "./observability/metrics.js";
import type { Document } from "@jsonstore/sdk";

// Helper to wrap tool execution with timeout, logging, and metrics
async function executeTool<T>(
  toolName: string,
  timeoutMs: number,
  handler: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  let success = false;
  let error: Error | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutError = new Error(`Tool execution timeout after ${timeoutMs}ms`);
        (timeoutError as any).code = "ETIMEDOUT";
        reject(timeoutError);
      }, timeoutMs);
    });

    const handlerPromise = handler();

    // Race between handler and timeout
    const result = await Promise.race([handlerPromise, timeoutPromise]);
    success = true;
    return result;
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    const duration = Date.now() - startTime;
    logger.toolCall(toolName, duration, success, error);
    recordToolExecution(toolName, duration, success, (error as any)?.code);
  }
}

/**
 * get_doc: Retrieve a document by type and ID
 */
export async function getDoc(args: unknown) {
  const { type, id } = GetDocInputSchema.parse(args);

  return executeTool("get_doc", 2000, async () => {
    const doc = await jsonStoreService.get({ type, id });

    return {
      content: [
        {
          type: "text",
          text: doc ? `Found document ${type}/${id}` : `Document ${type}/${id} not found`,
        },
        {
          type: "json",
          json: { doc },
        },
      ],
    };
  });
}

/**
 * put_doc: Store or update a document
 */
export async function putDoc(args: unknown) {
  const { type, id, doc, commit } = PutDocInputSchema.parse(args);

  return executeTool("put_doc", 5000, async () => {
    await jsonStoreService.put({ type, id }, doc as Document, commit?.message);

    return {
      content: [
        {
          type: "text",
          text: `Stored ${type}/${id}`,
        },
        {
          type: "json",
          json: { ok: true },
        },
      ],
    };
  });
}

/**
 * rm_doc: Remove a document (idempotent)
 */
export async function removeDoc(args: unknown) {
  const { type, id, commit } = RemoveDocInputSchema.parse(args);

  return executeTool("rm_doc", 5000, async () => {
    await jsonStoreService.remove({ type, id }, commit?.message);

    return {
      content: [
        {
          type: "text",
          text: `Removed ${type}/${id}`,
        },
        {
          type: "json",
          json: { ok: true },
        },
      ],
    };
  });
}

/**
 * list_ids: List all document IDs for a type
 */
export async function listIds(args: unknown) {
  const { type } = ListIdsInputSchema.parse(args);

  return executeTool("list_ids", 2000, async () => {
    const ids = await jsonStoreService.list(type);

    return {
      content: [
        {
          type: "text",
          text: `Found ${ids.length} documents of type ${type}`,
        },
        {
          type: "json",
          json: { ids, count: ids.length },
        },
      ],
    };
  });
}

/**
 * query: Execute a Mango query
 */
export async function query(args: unknown) {
  const querySpec = QueryInputSchema.parse(args);

  return executeTool("query", 5000, async () => {
    const results = await jsonStoreService.query(querySpec as any);

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} matching documents`,
        },
        {
          type: "json",
          json: { results, count: results.length },
        },
      ],
    };
  });
}

/**
 * ensure_index: Create or update an index
 */
export async function ensureIndex(args: unknown) {
  const { type, field } = EnsureIndexInputSchema.parse(args);

  return executeTool("ensure_index", 5000, async () => {
    await jsonStoreService.ensureIndex(type, field);

    return {
      content: [
        {
          type: "text",
          text: `Index created on ${type}.${field}`,
        },
        {
          type: "json",
          json: { ok: true },
        },
      ],
    };
  });
}

/**
 * Tool definitions for MCP server
 * Maps tool names to their schemas and handlers
 */
export const toolDefinitions = [
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
          description: "Entity type",
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
              description: "Batch identifier for grouping commits",
            },
          },
        },
      },
      required: ["type", "id", "doc"],
    },
  },
  {
    name: "rm_doc",
    description: "Remove a document (idempotent - no error if missing)",
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
    description: "List all document IDs for a given type (capped at 5000)",
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
    description: "Query documents using Mango query language (limit max 1000, default 100)",
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
            "Mango filter object (supports $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $exists, $type, $and, $or, $not)",
        },
        projection: {
          type: "object",
          description: "Fields to include (1) or exclude (0) - cannot mix 0 and 1",
        },
        sort: {
          type: "object",
          description: "Sort specification (1 for ascending, -1 for descending)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (max 1000, default 100)",
        },
        skip: {
          type: "number",
          description: "Number of results to skip (for pagination, max 10000)",
        },
      },
      required: ["filter"],
    },
  },
  {
    name: "ensure_index",
    description: "Create or update an equality index for fast lookups on a field (idempotent)",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Entity type",
        },
        field: {
          type: "string",
          description: "Field name to index (supports dot notation for nested fields)",
        },
      },
      required: ["type", "field"],
    },
  },
];

/**
 * Tool handlers map
 */
export const toolHandlers = {
  get_doc: getDoc,
  put_doc: putDoc,
  rm_doc: removeDoc,
  list_ids: listIds,
  query: query,
  ensure_index: ensureIndex,
};
