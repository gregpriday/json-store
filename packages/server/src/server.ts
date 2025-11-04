#!/usr/bin/env node

/**
 * MCP server for JSON Store
 * Exposes JSON Store CRUD/query capabilities via stdio transport
 *
 * Protocol: Model Context Protocol (MCP) over stdio
 * All logging goes to stderr; stdout is reserved for protocol frames
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toolDefinitions, toolHandlers } from "./tools.js";
import { logger } from "./observability/logger.js";

/**
 * Map validation errors to MCP error codes
 */
function mapErrorToMcp(error: unknown): { code: number; message: string } {
  if (error instanceof z.ZodError) {
    // Zod validation errors -> Invalid params
    return {
      code: ErrorCode.InvalidParams,
      message: `Validation error: ${error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
    };
  }

  if (error instanceof Error) {
    // Check for specific error codes
    const errCode = (error as any).code;

    if (errCode === "ENOENT") {
      // Document not found
      return {
        code: ErrorCode.InvalidRequest,
        message: `Document not found: ${error.message}`,
      };
    }

    if (errCode === "EACCES" || errCode === "EPERM") {
      // Permission errors
      return {
        code: ErrorCode.InternalError,
        message: `Permission denied: ${error.message}`,
      };
    }

    if (error.message.toLowerCase().includes("timeout")) {
      // Timeout errors
      return {
        code: ErrorCode.RequestTimeout,
        message: error.message,
      };
    }

    // Generic error
    return {
      code: ErrorCode.InternalError,
      message: error.message,
    };
  }

  // Unknown error type
  return {
    code: ErrorCode.InternalError,
    message: String(error),
  };
}

/**
 * Create and configure the MCP server
 */
async function main() {
  // Override console methods to prevent accidental stdout pollution
  // MCP protocol uses stdout, so any stray console.log/info/debug breaks it
  const redirectToStderr =
    (method: string) =>
    (...args: any[]) => {
      console.error(`[WARN] Attempted ${method} (redirected to stderr):`, ...args);
    };
  console.log = redirectToStderr("console.log");
  console.info = redirectToStderr("console.info");
  console.debug = redirectToStderr("console.debug");

  // Check if read-only mode is enabled
  const readOnlyMode = process.env.MCP_JSONSTORE_READONLY === "true";
  const enabled = process.env.MCP_JSONSTORE_ENABLED !== "false"; // Default: enabled

  if (!enabled) {
    console.error("MCP JSON Store server is disabled (MCP_JSONSTORE_ENABLED=false)");
    process.exit(0);
  }

  if (readOnlyMode) {
    logger.info("server.init", { mode: "readonly" });
  }

  const server = new Server(
    {
      name: "jsonstore-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Filter tools based on read-only mode
    const tools = readOnlyMode
      ? toolDefinitions.filter((t) => ["get_doc", "list_ids", "query"].includes(t.name))
      : toolDefinitions;

    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Check if tool is allowed in read-only mode
      if (readOnlyMode && !["get_doc", "list_ids", "query"].includes(name)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Tool '${name}' not available in read-only mode`
        );
      }

      // Get tool handler
      const handler = (toolHandlers as any)[name];
      if (!handler) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      // Execute tool handler
      const result = await handler(args);
      return result;
    } catch (error) {
      // Log error
      const err = error instanceof Error ? error : new Error(String(error));
      const errCode = (err as any)?.code;
      logger.error("server.tool.error", {
        tool: name,
        err_code: errCode === undefined ? undefined : String(errCode),
        err_message: err.message,
        stack: err.stack,
      });

      // Map error to MCP error code
      if (error instanceof McpError) {
        throw error;
      }

      const { code, message } = mapErrorToMcp(error);
      throw new McpError(code, message);
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("server.start", {
    mode: readOnlyMode ? "readonly" : "readwrite",
    data_root: process.env.DATA_ROOT || "./data",
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("server.shutdown", {});
    await transport.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error("server.fatal", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
