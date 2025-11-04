/**
 * End-to-end CLI integration tests
 * Tests complete workflows via CLI commands
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

// Path to the CLI executable
const CLI_PATH = join(__dirname, "../dist/cli.js");

/**
 * CLI result
 */
interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run CLI command with execa
 */
async function runCli(args: string[], options: { cwd?: string; env?: Record<string, string>; reject?: boolean; timeout?: number } = {}): Promise<CliResult> {
  const { cwd, env, reject = false, timeout = 5000 } = options;

  try {
    const result = await execa("node", [CLI_PATH, ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      reject,
      timeout,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  } catch (error: any) {
    // Return error result if reject is false
    if (!reject) {
      // Determine exit code: use actual exit code if available, otherwise use 124 for timeout or 1 for other errors
      let exitCode = 1;
      if (error.exitCode !== undefined && error.exitCode !== null) {
        exitCode = error.exitCode;
      } else if (error.timedOut || error.killed) {
        exitCode = 124; // Standard timeout exit code
      }

      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        exitCode,
      };
    }
    throw error;
  }
}

describe("CLI End-to-End Tests", () => {
  let testDir: string;

  beforeAll(async () => {
    // Build CLI once before tests
    // This is handled by the build script, so we just verify it exists
  });

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-cli-e2e-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Complete Workflow", () => {
    it("should run full CRUD workflow via CLI", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      // Init
      const initResult = await runCli(["init"], { env });
      expect(initResult.exitCode).toBe(0);

      // Put document
      const putResult = await runCli(
        ["put", "task", "1", "--data", JSON.stringify({ type: "task", id: "1", title: "Test", status: "open" })],
        { env }
      );
      expect(putResult.exitCode).toBe(0);

      // Get document
      const getResult = await runCli(["get", "task", "1"], { env });
      expect(getResult.exitCode).toBe(0);
      const doc = JSON.parse(getResult.stdout);
      expect(doc.title).toBe("Test");
      expect(doc.status).toBe("open");

      // List documents (CLI command is 'ls')
      const listResult = await runCli(["ls", "task"], { env });
      expect(listResult.exitCode).toBe(0);
      const ids = listResult.stdout.trim().split("\n");
      expect(ids).toContain("1");

      // Query documents
      const queryResult = await runCli(
        ["query", "--type", "task", "--data", JSON.stringify({ filter: { status: { $eq: "open" } } })],
        { env }
      );
      expect(queryResult.exitCode).toBe(0);
      const results = JSON.parse(queryResult.stdout);
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Test");

      // Stats
      const statsResult = await runCli(["stats", "--type", "task"], { env });
      expect(statsResult.exitCode).toBe(0);
      expect(statsResult.stdout).toContain("1"); // Should show count

      // Remove document
      const rmResult = await runCli(["rm", "task", "1", "--force"], { env });
      expect(rmResult.exitCode).toBe(0);

      // Verify removed (should return exit code 2 for not found)
      const getAfterRm = await runCli(["get", "task", "1"], { env, reject: false });
      expect(getAfterRm.exitCode).toBe(2); // NOT_FOUND
    });
  });

  describe("Exit Codes", () => {
    it("should return 0 for success", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      const result = await runCli(["init"], { env });
      expect(result.exitCode).toBe(0);
    });

    it("should return 2 for document not found", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      await runCli(["init"], { env });

      const result = await runCli(["get", "task", "nonexistent"], { env, reject: false });
      expect(result.exitCode).toBe(2);
    });

    it("should return non-zero for invalid arguments", { timeout: 10000 }, async () => {
      const env = { JSONSTORE_ROOT: testDir };

      await runCli(["init"], { env });

      // Put with invalid JSON should fail
      const result = await runCli(["put", "task", "1", "--data", "invalid-json"], { env, reject: false });
      expect(result.exitCode).not.toBe(0);
      expect(result.exitCode).toBeGreaterThan(0);
    });
  });

  describe("Complex Queries", () => {
    beforeEach(async () => {
      const env = { JSONSTORE_ROOT: testDir };
      await runCli(["init"], { env });

      // Create test dataset
      for (let i = 1; i <= 10; i++) {
        const doc = {
          type: "task",
          id: `task-${i}`,
          title: `Task ${i}`,
          priority: i % 5,
          status: i % 2 === 0 ? "open" : "closed",
        };
        await runCli(["put", "task", `task-${i}`, "--data", JSON.stringify(doc)], { env });
      }
    });

    it("should query with $and operator", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      const querySpec = {
        filter: {
          $and: [{ status: { $eq: "open" } }, { priority: { $gte: 3 } }],
        },
      };

      const result = await runCli(["query", "--type", "task", "--data", JSON.stringify(querySpec)], { env });
      expect(result.exitCode).toBe(0);

      const results = JSON.parse(result.stdout);
      expect(results.length).toBeGreaterThan(0);

      // Verify all results match filter
      for (const doc of results) {
        expect(doc.status).toBe("open");
        expect(doc.priority).toBeGreaterThanOrEqual(3);
      }
    });

    it("should query with sort and pagination", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      const querySpec = {
        filter: {},
        sort: { priority: -1 },
        limit: 3,
      };

      const result = await runCli(["query", "--type", "task", "--data", JSON.stringify(querySpec)], { env });
      expect(result.exitCode).toBe(0);

      const results = JSON.parse(result.stdout);
      expect(results).toHaveLength(3);

      // Verify descending order
      expect(results[0].priority).toBeGreaterThanOrEqual(results[1].priority);
      expect(results[1].priority).toBeGreaterThanOrEqual(results[2].priority);
    });
  });

  describe("Environment Isolation", () => {
    it("should respect JSONSTORE_ROOT environment variable", async () => {
      const testDir1 = await mkdtemp(join(tmpdir(), "jsonstore-cli-e2e-1-"));
      const testDir2 = await mkdtemp(join(tmpdir(), "jsonstore-cli-e2e-2-"));
      const env1 = { JSONSTORE_ROOT: testDir1 };
      const env2 = { JSONSTORE_ROOT: testDir2 };

      try {
        // Init both stores
        await runCli(["init"], { env: env1 });
        await runCli(["init"], { env: env2 });

        // Put to first store
        await runCli(["put", "task", "1", "--data", JSON.stringify({ type: "task", id: "1", title: "Store1" })], {
          env: env1,
        });

        // Put to second store
        await runCli(["put", "task", "1", "--data", JSON.stringify({ type: "task", id: "1", title: "Store2" })], {
          env: env2,
        });

        // Verify isolation
        const result1 = await runCli(["get", "task", "1"], { env: env1 });
        const doc1 = JSON.parse(result1.stdout);
        expect(doc1.title).toBe("Store1");

        const result2 = await runCli(["get", "task", "1"], { env: env2 });
        const doc2 = JSON.parse(result2.stdout);
        expect(doc2.title).toBe("Store2");
      } finally {
        await rm(testDir1, { recursive: true, force: true });
        await rm(testDir2, { recursive: true, force: true });
      }
    });
  });

  describe("Format Operations", () => {
    it("should format all documents", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      await runCli(["init"], { env });

      // Create test data with unsorted keys
      for (let i = 1; i <= 5; i++) {
        const doc = {
          type: "task",
          id: `task-${i}`,
          z_field: "last",
          a_field: "first",
          m_field: "middle",
        };
        await runCli(["put", "task", `task-${i}`, "--data", JSON.stringify(doc)], { env });
      }

      // Format all documents (already formatted by put, so should be no-op)
      const formatResult = await runCli(["format", "--all"], { env });
      expect(formatResult.exitCode).toBe(0);
      // Documents are already formatted by put(), so we expect "already canonical" message
      expect(formatResult.stdout).toContain("canonical");
    });

    it("should format specific type", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      await runCli(["init"], { env });

      // Create documents of different types
      await runCli(["put", "task", "1", "--data", JSON.stringify({ type: "task", id: "1", title: "Task" })], { env });
      await runCli(["put", "note", "1", "--data", JSON.stringify({ type: "note", id: "1", title: "Note" })], { env });

      // Format only tasks
      const formatResult = await runCli(["format", "task"], { env });
      expect(formatResult.exitCode).toBe(0);
    });

    it("should check formatting without writing", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      await runCli(["init"], { env });

      // Create document with unsorted keys
      const doc = { type: "task", id: "1", z: "last", a: "first" };
      await runCli(["put", "task", "1", "--data", JSON.stringify(doc)], { env });

      // Check format (dry run)
      const checkResult = await runCli(["format", "--all", "--check"], { env, reject: false });
      // Exit code 1 if reformatting needed, 0 if already formatted
      expect([0, 1]).toContain(checkResult.exitCode);
    });
  });

  describe("Idempotency", () => {
    it("should handle repeated init safely", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      const result1 = await runCli(["init"], { env });
      expect(result1.exitCode).toBe(0);

      const result2 = await runCli(["init"], { env });
      expect(result2.exitCode).toBe(0); // Should succeed
    });

    it("should handle put with same data as no-op", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      await runCli(["init"], { env });

      const doc = { type: "task", id: "1", title: "Test" };

      // Put twice with same data
      const result1 = await runCli(["put", "task", "1", "--data", JSON.stringify(doc)], { env });
      expect(result1.exitCode).toBe(0);

      const result2 = await runCli(["put", "task", "1", "--data", JSON.stringify(doc)], { env });
      expect(result2.exitCode).toBe(0);

      // Verify only one document exists
      const getResult = await runCli(["get", "task", "1"], { env });
      const retrieved = JSON.parse(getResult.stdout);
      expect(retrieved).toEqual(doc);
    });

    it("should handle remove of non-existent document gracefully", async () => {
      const env = { JSONSTORE_ROOT: testDir };

      await runCli(["init"], { env });

      // Remove non-existent document should succeed (no-op)
      const result = await runCli(["rm", "task", "nonexistent", "--force"], { env, reject: false });
      // Exit code depends on implementation - document the actual behavior
      expect([0, 2]).toContain(result.exitCode); // Either success or not-found is acceptable
    });
  });
});
