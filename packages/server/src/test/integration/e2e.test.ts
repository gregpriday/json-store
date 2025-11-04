/**
 * End-to-end MCP server integration tests
 * Tests the complete JSON-RPC protocol over stdio
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to server executable
const SERVER_PATH = join(__dirname, "../../../dist/server.js");

/**
 * JSON-RPC request
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id: number | string;
}

/**
 * JSON-RPC response
 */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  id: number | string;
}

/**
 * MCP server client for testing
 */
class McpTestClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingResponses = new Map<number | string, (response: JsonRpcResponse) => void>();
  private buffer = "";

  async start(env: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      this.process = spawn("node", [SERVER_PATH], {
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!this.process.stdout || !this.process.stdin) {
        reject(new Error("Failed to create process with stdio"));
        return;
      }

      // Set up stdout handler for responses
      this.process.stdout.on("data", (chunk) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });

      // Set up stderr handler for logs
      this.process.stderr?.on("data", (chunk) => {
        // Ignore stderr logs in tests
      });

      const handleError = (err: Error) => {
        if (!settled) {
          settled = true;
          this.process?.off("exit", handleExit);
          reject(err);
        }
      };

      const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (!settled) {
          settled = true;
          this.process?.off("error", handleError);
          reject(
            new Error(`Server exited before it became ready (code=${code}, signal=${signal ?? "null"})`)
          );
        }
      };

      this.process.on("error", handleError);
      this.process.on("exit", handleExit);

      setTimeout(() => {
        if (!settled) {
          settled = true;
          this.process?.off("error", handleError);
          this.process?.off("exit", handleExit);
          resolve();
        }
      }, 150);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response: JsonRpcResponse = JSON.parse(line);
          const resolver = this.pendingResponses.get(response.id);
          if (resolver) {
            resolver(response);
            this.pendingResponses.delete(response.id);
          }
        } catch (err) {
          console.error("Failed to parse JSON-RPC response:", line);
        }
      }
    }
  }

  async call(method: string, params?: any): Promise<JsonRpcResponse> {
    if (!this.process?.stdin) {
      throw new Error("Server not started");
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id,
    };

    return new Promise((resolve, reject) => {
      // Set up response handler
      this.pendingResponses.set(id, resolve);

      // Send request
      this.process!.stdin!.write(JSON.stringify(request) + "\n");

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingResponses.has(id)) {
          this.pendingResponses.delete(id);
          reject(new Error(`Request ${id} timed out`));
        }
      }, 5000);
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGTERM");
      await new Promise((resolve) => {
        this.process!.on("exit", resolve);
        setTimeout(() => {
          this.process?.kill("SIGKILL");
          resolve(null);
        }, 1000);
      });
      this.process = null;
    }
  }
}

describe("MCP Server E2E Tests", () => {
  let client: McpTestClient;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-mcp-e2e-"));
    client = new McpTestClient();
    await client.start({ DATA_ROOT: testDir });
  });

  afterEach(async () => {
    await client.stop();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Protocol Compliance", () => {
    it("should respond to tools/list", async () => {
      const response = await client.call("tools/list");

      expect(response.jsonrpc).toBe("2.0");
      expect(response.result).toBeDefined();
      expect(Array.isArray(response.result.tools)).toBe(true);
      expect(response.result.tools.length).toBeGreaterThan(0);

      // Verify tool structure
      const firstTool = response.result.tools[0];
      expect(firstTool).toHaveProperty("name");
      expect(firstTool).toHaveProperty("description");
      expect(firstTool).toHaveProperty("inputSchema");
    });

    it("should return error for unknown method", async () => {
      const response = await client.call("unknown/method");

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBeDefined();
      expect(response.error?.message).toBeDefined();
    });

    it("should return error for invalid params", async () => {
      const response = await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          // Missing required fields
          type: "task",
        },
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain("Validation");
    });
  });

  describe("Tool Execution", () => {
    it("should put and get a document", async () => {
      const doc = { type: "task", id: "test-1", title: "Test Task", status: "open" };

      // Put document
      const putResponse = await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "test-1",
          doc,
        },
      });

      expect(putResponse.result).toBeDefined();
      expect(putResponse.result.content).toBeDefined();
      expect(Array.isArray(putResponse.result.content)).toBe(true);

      // Find JSON content in response
      const jsonContent = putResponse.result.content.find((c: any) => c.type === "json");
      expect(jsonContent).toBeDefined();
      expect(jsonContent.json.ok).toBe(true);

      // Get document
      const getResponse = await client.call("tools/call", {
        name: "get_doc",
        arguments: {
          type: "task",
          id: "test-1",
        },
      });

      expect(getResponse.result).toBeDefined();
      const getJsonContent = getResponse.result.content.find((c: any) => c.type === "json");
      expect(getJsonContent).toBeDefined();
      expect(getJsonContent.json.doc).toEqual(doc);
    });

    it("should handle document not found", async () => {
      const response = await client.call("tools/call", {
        name: "get_doc",
        arguments: {
          type: "task",
          id: "nonexistent",
        },
      });

      // Should return error or null document
      if (response.error) {
        expect(response.error.message).toContain("not found");
      } else {
        const jsonContent = response.result.content.find((c: any) => c.type === "json");
        expect(jsonContent.json.doc).toBeNull();
      }
    });

    it("should list document IDs", async () => {
      // Put multiple documents
      for (let i = 1; i <= 5; i++) {
        await client.call("tools/call", {
          name: "put_doc",
          arguments: {
            type: "task",
            id: `task-${i}`,
            doc: { type: "task", id: `task-${i}`, title: `Task ${i}` },
          },
        });
      }

      // List IDs
      const response = await client.call("tools/call", {
        name: "list_ids",
        arguments: {
          type: "task",
        },
      });

      expect(response.result).toBeDefined();
      const jsonContent = response.result.content.find((c: any) => c.type === "json");
      expect(jsonContent).toBeDefined();
      expect(jsonContent.json.ids).toHaveLength(5);
      expect(jsonContent.json.ids).toContain("task-1");
      expect(jsonContent.json.ids).toContain("task-5");
    });

    it("should query documents", async () => {
      // Put test documents
      await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "task-1",
          doc: { type: "task", id: "task-1", status: "open", priority: 5 },
        },
      });

      await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "task-2",
          doc: { type: "task", id: "task-2", status: "closed", priority: 3 },
        },
      });

      await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "task-3",
          doc: { type: "task", id: "task-3", status: "open", priority: 8 },
        },
      });

      // Query for open tasks - use flat filter structure
      const response = await client.call("tools/call", {
        name: "query",
        arguments: {
          type: "task",
          filter: { status: { $eq: "open" } },
          sort: { priority: -1 },
        },
      });

      expect(response.result).toBeDefined();
      const jsonContent = response.result.content.find((c: any) => c.type === "json");
      expect(jsonContent).toBeDefined();
      expect(jsonContent.json.results).toHaveLength(2);
      expect(jsonContent.json.count).toBe(2);
      expect(jsonContent.json.results[0].priority).toBe(8);
      expect(jsonContent.json.results[1].priority).toBe(5);
    });

    it("should remove documents", async () => {
      // Put document
      await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "task-1",
          doc: { type: "task", id: "task-1", title: "Test" },
        },
      });

      // Remove document - use correct tool name
      const removeResponse = await client.call("tools/call", {
        name: "rm_doc",
        arguments: {
          type: "task",
          id: "task-1",
        },
      });

      expect(removeResponse.result).toBeDefined();
      const jsonContent = removeResponse.result.content.find((c: any) => c.type === "json");
      expect(jsonContent.json.ok).toBe(true);

      // Verify removed
      const getResponse = await client.call("tools/call", {
        name: "get_doc",
        arguments: {
          type: "task",
          id: "task-1",
        },
      });

      const getJsonContent = getResponse.result.content.find((c: any) => c.type === "json");
      expect(getJsonContent.json.doc).toBeNull();
    });

    it("should create indexes", async () => {
      // Create test documents
      for (let i = 1; i <= 10; i++) {
        await client.call("tools/call", {
          name: "put_doc",
          arguments: {
            type: "task",
            id: `task-${i}`,
            doc: { type: "task", id: `task-${i}`, status: i % 2 === 0 ? "open" : "closed" },
          },
        });
      }

      // Create index
      const response = await client.call("tools/call", {
        name: "ensure_index",
        arguments: {
          type: "task",
          field: "status",
        },
      });

      expect(response.result).toBeDefined();
      const jsonContent = response.result.content.find((c: any) => c.type === "json");
      expect(jsonContent.json.ok).toBe(true);

      // Subsequent queries should use index (verify by querying)
      const queryResponse = await client.call("tools/call", {
        name: "query",
        arguments: {
          type: "task",
          filter: { status: { $eq: "open" } },
        },
      });

      const queryJsonContent = queryResponse.result.content.find((c: any) => c.type === "json");
      expect(queryJsonContent.json.results).toHaveLength(5);
      expect(queryJsonContent.json.count).toBe(5);
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown tool name with error code", async () => {
      const response = await client.call("tools/call", {
        name: "unknown_tool",
        arguments: {},
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain("Unknown tool");
      expect(response.error?.code).toBe(-32601); // MethodNotFound
    });

    it("should validate tool arguments with error code", async () => {
      const response = await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          // Invalid: missing required fields
          type: "task",
        },
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602); // InvalidParams
      expect(response.error?.message).toContain("Validation");
    });

    it("should handle document not found with proper error", async () => {
      const response = await client.call("tools/call", {
        name: "get_doc",
        arguments: {
          type: "nonexistent",
          id: "missing",
        },
      });

      // Should return result with null doc, not an error
      if (response.error) {
        expect(response.error.message).toContain("not found");
      } else {
        const jsonContent = response.result.content.find((c: any) => c.type === "json");
        expect(jsonContent.json.doc).toBeNull();
      }
    });
  });

  describe("Round-Trip Persistence", () => {
    it("should persist data across multiple operations", async () => {
      // Put multiple documents
      await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "task-1",
          doc: { type: "task", id: "task-1", title: "First" },
        },
      });

      await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "task-2",
          doc: { type: "task", id: "task-2", title: "Second" },
        },
      });

      // List should show both
      const listResponse = await client.call("tools/call", {
        name: "list_ids",
        arguments: { type: "task" },
      });

      const listJsonContent = listResponse.result.content.find((c: any) => c.type === "json");
      expect(listJsonContent.json.ids).toHaveLength(2);

      // Update one document
      await client.call("tools/call", {
        name: "put_doc",
        arguments: {
          type: "task",
          id: "task-1",
          doc: { type: "task", id: "task-1", title: "Updated First" },
        },
      });

      // Verify update
      const getResponse = await client.call("tools/call", {
        name: "get_doc",
        arguments: { type: "task", id: "task-1" },
      });

      const getJsonContent = getResponse.result.content.find((c: any) => c.type === "json");
      expect(getJsonContent.json.doc.title).toBe("Updated First");

      // List should still show both
      const listResponse2 = await client.call("tools/call", {
        name: "list_ids",
        arguments: { type: "task" },
      });

      const listJsonContent2 = listResponse2.result.content.find((c: any) => c.type === "json");
      expect(listJsonContent2.json.ids).toHaveLength(2);
    });
  });
});
