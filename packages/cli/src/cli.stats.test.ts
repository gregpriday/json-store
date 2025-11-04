import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { openStore } from "@jsonstore/sdk";
import type { Store } from "@jsonstore/sdk";

/**
 * Execute CLI command and return output
 */
async function execCLI(
  args: string[],
  env?: Record<string, string>
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const cliPath = join(process.cwd(), "dist", "cli.js");
    const child = spawn("node", [cliPath, ...args], {
      env: { ...process.env, ...env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

describe("CLI stats command", () => {
  let testDir: string;
  let store: Store;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-cli-test-"));
    store = openStore({ root: testDir });
  });

  afterEach(async () => {
    await store.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("basic stats output", () => {
    it("should display stats for empty store", async () => {
      const result = await execCLI(["stats"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Documents: 0");
      expect(result.stdout).toContain("Total size: 0 B");
    });

    it("should display stats for store with documents", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });

      const result = await execCLI(["stats"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Documents: 2");
      expect(result.stdout).toMatch(/Total size: \d+(\.\d+)? [KMGT]?B/);
    });

    it("should display stats for specific type", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });

      const result = await execCLI(["stats", "--type", "user"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Documents: 2");
    });
  });

  describe("detailed stats output", () => {
    it("should display detailed stats", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });

      const result = await execCLI(["stats", "--detailed"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Documents: 2");
      expect(result.stdout).toContain("Total size:");
      expect(result.stdout).toContain("Average size:");
      expect(result.stdout).toContain("Min size:");
      expect(result.stdout).toContain("Max size:");
      expect(result.stdout).toContain("By Type:");
      expect(result.stdout).toContain("user:");
    });

    it("should display per-type breakdown in detailed stats", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });

      const result = await execCLI(["stats", "--detailed"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("By Type:");
      expect(result.stdout).toContain("user: 1 docs");
      expect(result.stdout).toContain("post: 1 docs");
    });
  });

  describe("JSON output", () => {
    it("should output basic stats as JSON", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      const result = await execCLI(["stats", "--json"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);

      const stats = JSON.parse(result.stdout);
      expect(stats).toHaveProperty("count");
      expect(stats).toHaveProperty("bytes");
      expect(stats.count).toBe(1);
      expect(stats.bytes).toBeGreaterThan(0);
    });

    it("should output detailed stats as JSON", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      const result = await execCLI(["stats", "--detailed", "--json"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);

      const stats = JSON.parse(result.stdout);
      expect(stats).toHaveProperty("count");
      expect(stats).toHaveProperty("bytes");
      expect(stats).toHaveProperty("avgBytes");
      expect(stats).toHaveProperty("minBytes");
      expect(stats).toHaveProperty("maxBytes");
      expect(stats).toHaveProperty("types");
      expect(stats.types).toHaveProperty("user");
    });

    it("should output type-specific stats as JSON", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });

      const result = await execCLI(["stats", "--type", "user", "--json"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);

      const stats = JSON.parse(result.stdout);
      expect(stats.count).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should handle invalid type name gracefully", async () => {
      const result = await execCLI(["stats", "--type", "../etc"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid type name");
    });

    it("should exit with code 3 when stats are disabled", async () => {
      const result = await execCLI(["stats"], {
        DATA_ROOT: testDir,
        JSONSTORE_ENABLE_STATS: "0",
      });

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain("Stats command is disabled");
    });
  });

  describe("byte formatting", () => {
    it("should format bytes correctly", async () => {
      // Create a small document
      await store.put({ type: "tiny", id: "t1" }, { type: "tiny", id: "t1", x: "a" });

      const result1 = await execCLI(["stats"], { DATA_ROOT: testDir });
      expect(result1.stdout).toMatch(/Total size: \d+(\.\d+)? B/);

      // Create a larger document (> 1KB)
      const largeData = "x".repeat(2000);
      await store.put({ type: "large", id: "l1" }, { type: "large", id: "l1", data: largeData });

      const result2 = await execCLI(["stats"], { DATA_ROOT: testDir });
      expect(result2.stdout).toMatch(/Total size: \d+(\.\d+)? [KM]B/);
    });
  });

  describe("non-existent type", () => {
    it("should show zero stats for non-existent type", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      const result = await execCLI(["stats", "--type", "nonexistent"], { DATA_ROOT: testDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Documents: 0");
      expect(result.stdout).toContain("Total size: 0 B");
    });
  });
});
