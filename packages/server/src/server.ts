#!/usr/bin/env node

/**
 * MCP server for JSON Store
 * Supports stdio transport for local development
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./tools.js";

/**
 * Create and configure the MCP server
 */
async function main() {
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
    return {
      tools,
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "get_doc": {
          // Implementation will be added in later stages
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Not implemented yet",
                    tool: name,
                    args,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "put_doc": {
          // Implementation will be added in later stages
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Not implemented yet",
                    tool: name,
                    args,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "rm_doc": {
          // Implementation will be added in later stages
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Not implemented yet",
                    tool: name,
                    args,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "list_ids": {
          // Implementation will be added in later stages
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Not implemented yet",
                    tool: name,
                    args,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "query": {
          // Implementation will be added in later stages
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Not implemented yet",
                    tool: name,
                    args,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "ensure_index": {
          // Implementation will be added in later stages
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Not implemented yet",
                    tool: name,
                    args,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "git_commit": {
          // Implementation will be added in later stages
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Not implemented yet",
                    tool: name,
                    args,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: error instanceof Error ? error.message : String(error),
                tool: name,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("JSON Store MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
