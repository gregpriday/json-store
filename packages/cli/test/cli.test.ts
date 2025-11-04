/**
 * Integration tests for CLI commands
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the CLI executable
const CLI_PATH = path.join(__dirname, "../dist/cli.js");

/**
 * Helper to run CLI command
 */
async function runCli(
  args: string[],
  options?: {
    stdin?: string;
    cwd?: string;
    expectError?: boolean;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { stdin, cwd, expectError } = options ?? {};

  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      cwd: cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (error) => {
      if (expectError) {
        resolve({ stdout, stderr, exitCode: typeof child.exitCode === "number" ? child.exitCode : 1 });
      } else {
        reject(error);
      }
    });

    child.on("close", (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      if (!expectError && exitCode !== 0) {
        const err: NodeJS.ErrnoException = new Error(`CLI exited with code ${exitCode}`);
        (err as any).code = exitCode;
        (err as any).stdout = stdout;
        (err as any).stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });

    if (child.stdin) {
      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    }
  });
}

describe("CLI", () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tmpDir = path.join(__dirname, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe("init", () => {
    it("should initialize a store directory", async () => {
      const dataDir = path.join(tmpDir, "data");

      const result = await runCli(["init", "--root", dataDir]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Initialized store");

      // Verify directory structure
      const rootExists = await fs
        .access(dataDir)
        .then(() => true)
        .catch(() => false);
      const metaExists = await fs
        .access(path.join(dataDir, "_meta"))
        .then(() => true)
        .catch(() => false);

      expect(rootExists).toBe(true);
      expect(metaExists).toBe(true);
    });

    it("should be idempotent (can run multiple times)", async () => {
      const dataDir = path.join(tmpDir, "data");

      await runCli(["init", "--root", dataDir]);
      const result = await runCli(["init", "--root", dataDir]);

      expect(result.exitCode).toBe(0);
    });
  });

  describe("put", () => {
    beforeEach(async () => {
      await runCli(["init", "--root", tmpDir]);
    });

    it("should store a document with --data", async () => {
      const doc = { type: "user", id: "alice", name: "Alice" };

      const result = await runCli([
        "put",
        "user",
        "alice",
        "--root",
        tmpDir,
        "--data",
        JSON.stringify(doc),
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Stored user/alice");

      // Verify file was created
      const filePath = path.join(tmpDir, "user", "alice.json");
      const fileContent = await fs.readFile(filePath, "utf8");
      expect(JSON.parse(fileContent)).toEqual(doc);
    });

    it("should store a document with --file", async () => {
      const doc = { type: "user", id: "bob", name: "Bob" };
      const inputFile = path.join(tmpDir, "input.json");
      await fs.writeFile(inputFile, JSON.stringify(doc));

      const result = await runCli(["put", "user", "bob", "--root", tmpDir, "--file", inputFile]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Stored user/bob");
    });

    it("should store a document from stdin", async () => {
      const doc = { type: "user", id: "charlie", name: "Charlie" };

      const result = await runCli(["put", "user", "charlie", "--root", tmpDir], {
        stdin: JSON.stringify(doc),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Stored user/charlie");
    });

    it("should reject invalid JSON", async () => {
      const result = await runCli(
        ["put", "user", "dave", "--root", tmpDir, "--data", "{invalid}"],
        { expectError: true }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid JSON");
    });

    it("should reject multiple input sources", async () => {
      const result = await runCli(
        [
          "put",
          "user",
          "eve",
          "--root",
          tmpDir,
          "--data",
          '{"type":"user","id":"eve"}',
          "--file",
          "dummy.json",
        ],
        { expectError: true }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Cannot use both");
    });
  });

  describe("get", () => {
    beforeEach(async () => {
      await runCli(["init", "--root", tmpDir]);
      const doc = { type: "user", id: "alice", name: "Alice", age: 30 };
      await runCli(["put", "user", "alice", "--root", tmpDir, "--data", JSON.stringify(doc)]);
    });

    it("should retrieve a document", async () => {
      const result = await runCli(["get", "user", "alice", "--root", tmpDir]);

      expect(result.exitCode).toBe(0);
      const doc = JSON.parse(result.stdout);
      expect(doc).toEqual({ type: "user", id: "alice", name: "Alice", age: 30 });
    });

    it("should output raw JSON with --raw", async () => {
      const result = await runCli(["get", "user", "alice", "--root", tmpDir, "--raw"]);

      expect(result.exitCode).toBe(0);
      // Raw output should not have newlines/indentation
      expect(result.stdout).not.toContain("\n  ");
      const doc = JSON.parse(result.stdout);
      expect(doc.name).toBe("Alice");
    });

    it("should return exit code 2 for not found", async () => {
      const result = await runCli(["get", "user", "nonexistent", "--root", tmpDir], {
        expectError: true,
      });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("not found");
    });
  });

  describe("rm", () => {
    beforeEach(async () => {
      await runCli(["init", "--root", tmpDir]);
      const doc = { type: "user", id: "alice", name: "Alice" };
      await runCli(["put", "user", "alice", "--root", tmpDir, "--data", JSON.stringify(doc)]);
    });

    it("should remove a document with --force", async () => {
      const result = await runCli(["rm", "user", "alice", "--root", tmpDir, "--force"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Removed user/alice");

      // Verify file was removed
      const filePath = path.join(tmpDir, "user", "alice.json");
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("should require --force in non-interactive mode", async () => {
      const result = await runCli(["rm", "user", "alice", "--root", tmpDir], {
        expectError: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--force");
    });
  });

  describe("ls", () => {
    beforeEach(async () => {
      await runCli(["init", "--root", tmpDir]);

      // Create multiple documents
      for (const id of ["alice", "bob", "charlie"]) {
        const doc = { type: "user", id, name: id };
        await runCli(["put", "user", id, "--root", tmpDir, "--data", JSON.stringify(doc)]);
      }
    });

    it("should list document IDs", async () => {
      const result = await runCli(["ls", "user", "--root", tmpDir]);

      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines).toContain("alice");
      expect(lines).toContain("bob");
      expect(lines).toContain("charlie");
    });

    it("should output JSON array with --json", async () => {
      const result = await runCli(["ls", "user", "--root", tmpDir, "--json"]);

      expect(result.exitCode).toBe(0);
      const ids = JSON.parse(result.stdout);
      expect(Array.isArray(ids)).toBe(true);
      expect(ids).toContain("alice");
      expect(ids).toContain("bob");
      expect(ids).toContain("charlie");
    });

    it("should respect --limit", async () => {
      const result = await runCli(["ls", "user", "--root", tmpDir, "--json", "--limit", "2"]);

      expect(result.exitCode).toBe(0);
      const ids = JSON.parse(result.stdout);
      expect(ids.length).toBe(2);
    });

    it("should reject negative limit", async () => {
      const result = await runCli(["ls", "user", "--root", tmpDir, "--limit", "-1"], {
        expectError: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("non-negative");
    });
  });

  describe("query", () => {
    beforeEach(async () => {
      await runCli(["init", "--root", tmpDir]);

      // Create test documents
      const users = [
        { type: "user", id: "alice", name: "Alice", age: 30, role: "admin" },
        { type: "user", id: "bob", name: "Bob", age: 25, role: "user" },
        { type: "user", id: "charlie", name: "Charlie", age: 35, role: "user" },
      ];

      for (const user of users) {
        await runCli(["put", "user", user.id, "--root", tmpDir, "--data", JSON.stringify(user)]);
      }
    });

    it("should query with --data", async () => {
      const query = {
        type: "user",
        filter: { role: "user" },
      };

      const result = await runCli(["query", "--root", tmpDir, "--data", JSON.stringify(query)]);

      expect(result.exitCode).toBe(0);
      const results = JSON.parse(result.stdout);
      expect(results.length).toBe(2);
      expect(results.every((r: any) => r.role === "user")).toBe(true);
    });

    it("should query with stdin", async () => {
      const query = {
        type: "user",
        filter: { age: { $gte: 30 } },
      };

      const result = await runCli(["query", "--root", tmpDir], {
        stdin: JSON.stringify(query),
      });

      expect(result.exitCode).toBe(0);
      const results = JSON.parse(result.stdout);
      expect(results.length).toBe(2);
      expect(results.every((r: any) => r.age >= 30)).toBe(true);
    });

    it("should override query spec with CLI options", async () => {
      const query = {
        type: "user",
        filter: {},
        limit: 10,
      };

      const result = await runCli([
        "query",
        "--root",
        tmpDir,
        "--data",
        JSON.stringify(query),
        "--limit",
        "1",
      ]);

      expect(result.exitCode).toBe(0);
      const results = JSON.parse(result.stdout);
      expect(results.length).toBe(1);
    });

    it("should reject invalid query JSON", async () => {
      const result = await runCli(["query", "--root", tmpDir, "--data", "{invalid}"], {
        expectError: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid JSON");
    });
  });

  describe("format", () => {
    let docPath: string;
    const NON_CANONICAL_JSON = '{"name":"Alice","type":"user","id":"alice"}\n';
    const CANONICAL_JSON = '{\n  "id": "alice",\n  "name": "Alice",\n  "type": "user"\n}\n';

    const makeDocumentNonCanonical = async () => {
      await fs.writeFile(docPath, NON_CANONICAL_JSON);
    };

    const expectCanonicalDocument = async () => {
      const content = await fs.readFile(docPath, "utf8");
      expect(content).toBe(CANONICAL_JSON);
    };

    beforeEach(async () => {
      await runCli(["init", "--root", tmpDir]);

      const doc = { type: "user", id: "alice", name: "Alice" };
      await runCli(["put", "user", "alice", "--root", tmpDir, "--data", JSON.stringify(doc)]);

      docPath = path.join(tmpDir, "user", "alice.json");
    });

    it("should format all documents with --all", async () => {
      await makeDocumentNonCanonical();

      const result = await runCli(["format", "--root", tmpDir, "--all"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Formatted 1 document(s)");

      await expectCanonicalDocument();
    });

    it("should format by type", async () => {
      await makeDocumentNonCanonical();

      const result = await runCli(["format", "user", "--root", tmpDir]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Formatted 1 document(s)");

      await expectCanonicalDocument();
    });

    it("should format specific document", async () => {
      await makeDocumentNonCanonical();

      const result = await runCli(["format", "user", "alice", "--root", tmpDir]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Formatted 1 document(s)");

      await expectCanonicalDocument();
    });

    it("should report changes in check mode", async () => {
      await makeDocumentNonCanonical();

      const result = await runCli(
        ["format", "--root", tmpDir, "--all", "--check"],
        { expectError: true }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("document(s) need formatting");
      expect(result.stderr).toContain("Formatting check failed");

      const content = await fs.readFile(docPath, "utf8");
      expect(content).toBe(NON_CANONICAL_JSON);
    });

    it("should pass check mode when already canonical", async () => {
      const result = await runCli(["format", "--root", tmpDir, "--all", "--check"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("All documents are properly formatted");
    });

    it("should reject ambiguous scope", async () => {
      const result = await runCli(["format", "user", "--root", tmpDir, "--all"], {
        expectError: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Cannot use --all");
    });

    it("should require scope selection", async () => {
      const result = await runCli(["format", "--root", tmpDir], {
        expectError: true,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Specify --all");
    });
  });

  // Note: stats command tests are in cli.stats.test.ts

  describe("global options", () => {
    it("should respect --quiet", async () => {
      await runCli(["init", "--root", tmpDir]);

      const doc = { type: "user", id: "alice", name: "Alice" };
      const result = await runCli([
        "put",
        "user",
        "alice",
        "--root",
        tmpDir,
        "--data",
        JSON.stringify(doc),
        "--quiet",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });
  });

  describe("exit codes", () => {
    beforeEach(async () => {
      await runCli(["init", "--root", tmpDir]);
    });

    it("should return 0 for success", async () => {
      const result = await runCli(["ls", "user", "--root", tmpDir]);
      expect(result.exitCode).toBe(0);
    });

    it("should return 1 for validation errors", async () => {
      const result = await runCli(
        ["put", "user", "alice", "--root", tmpDir, "--data", "{invalid}"],
        { expectError: true }
      );
      expect(result.exitCode).toBe(1);
    });

    it("should return 2 for not found", async () => {
      const result = await runCli(["get", "user", "nonexistent", "--root", tmpDir], {
        expectError: true,
      });
      expect(result.exitCode).toBe(2);
    });
  });
});
