/**
 * Integration tests for format operation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "./store.js";
import { canonicalize, safeParseJson } from "./format/canonical.js";
import type { CanonicalOptions } from "./types.js";

describe("Format Operation", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-format-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Basic Formatting", () => {
    it("should format a single document", async () => {
      const store = openStore({ root: testDir });

      // Create document with non-canonical formatting
      const doc = { type: "task", id: "t1", z: "last", a: "first", m: "middle" };
      await store.put({ type: "task", id: "t1" }, doc);

      // Verify it exists
      const before = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      expect(before).toBeTruthy();

      // Format it
      const count = await store.format({ type: "task", id: "t1" });
      expect(count).toBe(0); // Already canonical from put()

      // Read and verify keys are alphabetically sorted
      const after = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      const parsed = JSON.parse(after);
      expect(Object.keys(parsed)).toEqual(["a", "id", "m", "type", "z"]);

      await store.close();
    });

    it("should format all documents of a type", async () => {
      const store = openStore({ root: testDir });

      // Create multiple documents
      await store.put({ type: "task", id: "t1" }, { type: "task", id: "t1", name: "Task 1" });
      await store.put({ type: "task", id: "t2" }, { type: "task", id: "t2", name: "Task 2" });
      await store.put({ type: "task", id: "t3" }, { type: "task", id: "t3", name: "Task 3" });

      // Manually write a non-canonical document
      const nonCanonical = '{"type":"task","id":"t4","z":"last","a":"first"}';
      await writeFile(join(testDir, "task", "t4.json"), nonCanonical, "utf-8");

      // Format the type
      const count = await store.format({ type: "task" });
      expect(count).toBe(1); // Only t4 needs formatting

      // Verify all documents are canonical
      const t4 = await readFile(join(testDir, "task", "t4.json"), "utf-8");
      const parsed = JSON.parse(t4);
      expect(Object.keys(parsed)).toEqual(["a", "id", "type", "z"]);

      await store.close();
    });

    it("should format all documents (--all)", async () => {
      const store = openStore({ root: testDir });

      // Create documents across multiple types
      await store.put({ type: "task", id: "t1" }, { type: "task", id: "t1", name: "Task 1" });
      await store.put({ type: "user", id: "u1" }, { type: "user", id: "u1", name: "User 1" });

      // Manually write non-canonical documents
      await mkdir(join(testDir, "task"), { recursive: true });
      await mkdir(join(testDir, "user"), { recursive: true });
      await writeFile(
        join(testDir, "task", "t2.json"),
        '{"type":"task","id":"t2","z":"last"}',
        "utf-8"
      );
      await writeFile(
        join(testDir, "user", "u2.json"),
        '{"type":"user","id":"u2","z":"last"}',
        "utf-8"
      );

      // Format all
      const count = await store.format({ all: true });
      expect(count).toBe(2); // t2 and u2

      await store.close();
    });

    it("should be idempotent - format already canonical doc is no-op", async () => {
      const store = openStore({ root: testDir });

      // Create canonical document
      const doc = { type: "task", id: "t1", name: "Test" };
      await store.put({ type: "task", id: "t1" }, doc);

      // Read original
      const before = await readFile(join(testDir, "task", "t1.json"), "utf-8");

      // Format it
      const count = await store.format({ type: "task", id: "t1" });
      expect(count).toBe(0); // No changes

      // Read after and compare
      const after = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      expect(after).toBe(before); // Identical bytes

      await store.close();
    });
  });

  describe("Formatting Rules", () => {
    it("should fix key ordering", async () => {
      const store = openStore({ root: testDir });

      // Manually write with wrong key order
      await mkdir(join(testDir, "task"), { recursive: true });
      const wrongOrder = JSON.stringify(
        { type: "task", id: "t1", zebra: "z", apple: "a" },
        null,
        2
      );
      await writeFile(join(testDir, "task", "t1.json"), wrongOrder + "\n", "utf-8");

      // Format it
      const count = await store.format({ type: "task", id: "t1" });
      expect(count).toBe(1);

      // Verify alphabetical order
      const content = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(Object.keys(parsed)).toEqual(["apple", "id", "type", "zebra"]);

      await store.close();
    });

    it("should fix indentation", async () => {
      const store = openStore({ root: testDir, indent: 2 });

      // Write with wrong indentation (4 spaces)
      await mkdir(join(testDir, "task"), { recursive: true });
      const wrongIndent = JSON.stringify({ type: "task", id: "t1", name: "Test" }, null, 4);
      await writeFile(join(testDir, "task", "t1.json"), wrongIndent + "\n", "utf-8");

      // Format it
      const count = await store.format({ type: "task", id: "t1" });
      expect(count).toBe(1);

      // Verify 2-space indentation
      const content = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      expect(content).toContain('  "id"'); // 2 spaces
      expect(content).not.toContain('    "id"'); // Not 4 spaces

      await store.close();
    });

    it("should ensure trailing newline", async () => {
      const store = openStore({ root: testDir });

      // Write without trailing newline
      await mkdir(join(testDir, "task"), { recursive: true });
      const noNewline = JSON.stringify({ type: "task", id: "t1" }, null, 2);
      await writeFile(join(testDir, "task", "t1.json"), noNewline, "utf-8"); // No \n

      // Format it
      const count = await store.format({ type: "task", id: "t1" });
      expect(count).toBe(1);

      // Verify trailing newline
      const content = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      expect(content.endsWith("\n")).toBe(true);
      expect(content.endsWith("\n\n")).toBe(false); // Only one newline

      await store.close();
    });

    it("should normalize EOL to LF", async () => {
      const store = openStore({ root: testDir });

      // Write with CRLF line endings (keys in wrong order to ensure it needs reformatting)
      await mkdir(join(testDir, "task"), { recursive: true });
      const withCRLF = '{\r\n  "type": "task",\r\n  "id": "t1",\r\n  "name": "Test"\r\n}\r\n';
      await writeFile(join(testDir, "task", "t1.json"), withCRLF, "utf-8");

      // Format it
      const count = await store.format({ type: "task", id: "t1" });
      expect(count).toBe(1);

      // Verify LF only
      const content = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      expect(content).not.toContain("\r\n");
      expect(content).toContain("\n");

      await store.close();
    });
  });

  describe("Byte Stability", () => {
    it("should be byte-stable - format twice produces identical output", async () => {
      const store = openStore({ root: testDir });

      // Create document
      await store.put({ type: "task", id: "t1" }, { type: "task", id: "t1", name: "Test" });

      // Format once
      await store.format({ type: "task", id: "t1" });
      const first = await readFile(join(testDir, "task", "t1.json"), "utf-8");

      // Format again
      await store.format({ type: "task", id: "t1" });
      const second = await readFile(join(testDir, "task", "t1.json"), "utf-8");

      // Should be identical
      expect(second).toBe(first);

      await store.close();
    });

    it("should not write unnecessarily (already canonical)", async () => {
      const store = openStore({ root: testDir });

      // Create canonical document
      await store.put({ type: "task", id: "t1" }, { type: "task", id: "t1", name: "Test" });

      // Track write count (we can't easily spy on atomicWrite, so we check return value)
      const count = await store.format({ type: "task", id: "t1" });
      expect(count).toBe(0); // No writes

      await store.close();
    });
  });

  describe("Edge Cases", () => {
    it("should return 0 for non-existent document in non-existent type", async () => {
      const store = openStore({ root: testDir });

      // Non-existent type returns 0 (no-op)
      const count = await store.format({ type: "nonexistent", id: "t1" });
      expect(count).toBe(0);

      await store.close();
    });

    it("should throw error for non-existent document with failFast", async () => {
      const store = openStore({ root: testDir });

      // Create the type directory
      await mkdir(join(testDir, "task"), { recursive: true });

      // Try to format non-existent document with failFast - throws error
      await expect(
        store.format({ type: "task", id: "nonexistent" }, { failFast: true })
      ).rejects.toThrow(/not found/i);

      await store.close();
    });

    it("should handle non-existent type (no-op)", async () => {
      const store = openStore({ root: testDir });

      const count = await store.format({ type: "nonexistent" });
      expect(count).toBe(0);

      await store.close();
    });

    it("should handle empty type (no-op)", async () => {
      const store = openStore({ root: testDir });

      // Create empty type directory
      await mkdir(join(testDir, "empty"), { recursive: true });

      const count = await store.format({ type: "empty" });
      expect(count).toBe(0);

      await store.close();
    });

    it("should handle corrupted JSON file", async () => {
      const store = openStore({ root: testDir });

      // Write invalid JSON
      await mkdir(join(testDir, "task"), { recursive: true });
      await writeFile(join(testDir, "task", "bad.json"), "{invalid json", "utf-8");

      // Format should continue (not fail)
      const count = await store.format({ type: "task" });
      expect(count).toBe(0); // Couldn't format the corrupted file

      await store.close();
    });

    it("should fail fast on corrupted JSON with failFast option", async () => {
      const store = openStore({ root: testDir });

      // Write invalid JSON
      await mkdir(join(testDir, "task"), { recursive: true });
      await writeFile(join(testDir, "task", "bad.json"), "{invalid json", "utf-8");

      // Format with failFast should throw
      await expect(store.format({ type: "task" }, { failFast: true })).rejects.toThrow(/format/i);

      await store.close();
    });
  });

  describe("Custom Options", () => {
    it("should respect custom indent", async () => {
      const store = openStore({ root: testDir, indent: 4 });

      await store.put({ type: "task", id: "t1" }, { type: "task", id: "t1", name: "Test" });

      // Verify 4-space indentation
      const content = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      expect(content).toContain('    "id"'); // 4 spaces
      // Check that it doesn't use 2 spaces by looking for the pattern with just 2 leading spaces
      const lines = content.split("\n");
      const hasOnlyTwoSpaceIndent = lines.some(
        (line) => line.startsWith('  "') && !line.startsWith("    ")
      );
      expect(hasOnlyTwoSpaceIndent).toBe(false);

      await store.close();
    });

    it("should respect custom key order", async () => {
      const store = openStore({ root: testDir, stableKeyOrder: ["type", "id", "name"] });

      await store.put(
        { type: "task", id: "t1" },
        { type: "task", id: "t1", name: "Test", zebra: "last" }
      );

      const content = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      // type, id, name should come first, then zebra (alphabetical fallback)
      expect(lines[1]).toContain('"type"');
      expect(lines[2]).toContain('"id"');
      expect(lines[3]).toContain('"name"');
      expect(lines[4]).toContain('"zebra"');

      await store.close();
    });
  });

  describe("Dry Run Mode (--check)", () => {
    it("should detect formatting drift without writing files", async () => {
      const store = openStore({ root: testDir });

      // Write non-canonical file
      await mkdir(join(testDir, "task"), { recursive: true });
      await writeFile(
        join(testDir, "task", "t1.json"),
        '{"type":"task","id":"t1","z":"last"}',
        "utf-8"
      );

      const before = await readFile(join(testDir, "task", "t1.json"), "utf-8");

      // Dry run
      const count = await store.format({ type: "task", id: "t1" }, { dryRun: true });
      expect(count).toBe(1); // Would reformat

      // File should be unchanged
      const after = await readFile(join(testDir, "task", "t1.json"), "utf-8");
      expect(after).toBe(before);

      await store.close();
    });

    it("should return 0 for already canonical documents", async () => {
      const store = openStore({ root: testDir });

      await store.put({ type: "task", id: "t1" }, { type: "task", id: "t1", name: "Test" });

      const count = await store.format({ type: "task", id: "t1" }, { dryRun: true });
      expect(count).toBe(0); // Already canonical

      await store.close();
    });
  });

  describe("Canonical Formatter Unit Tests", () => {
    it("should sort keys deterministically", () => {
      const opts: CanonicalOptions = {
        indent: 2,
        stableKeyOrder: true,
        eol: "LF",
        trailingNewline: true,
      };

      const input = { zebra: 1, apple: 2, middle: 3 };
      const result = canonicalize(input, opts);

      const parsed = JSON.parse(result);
      expect(Object.keys(parsed)).toEqual(["apple", "middle", "zebra"]);
    });

    it("should preserve arrays", () => {
      const opts: CanonicalOptions = {
        indent: 2,
        stableKeyOrder: true,
        eol: "LF",
        trailingNewline: true,
      };

      const input = { items: [3, 1, 2], nested: [{ z: 1, a: 2 }] };
      const result = canonicalize(input, opts);

      const parsed = JSON.parse(result);
      expect(parsed.items).toEqual([3, 1, 2]); // Order preserved
      expect(Object.keys(parsed.nested[0])).toEqual(["a", "z"]); // Keys sorted
    });

    it("should detect circular references", () => {
      const opts: CanonicalOptions = {
        indent: 2,
        stableKeyOrder: true,
        eol: "LF",
        trailingNewline: true,
      };

      const obj: any = { a: 1 };
      obj.self = obj; // Circular reference

      expect(() => canonicalize(obj, opts)).toThrow(/circular/i);
    });

    it("should normalize standalone CR line endings", () => {
      const opts: CanonicalOptions = {
        indent: 2,
        stableKeyOrder: true,
        eol: "LF",
        trailingNewline: true,
      };

      const spy = vi.spyOn(JSON, "stringify").mockReturnValueOnce('{\r  "a": 1\r}');
      try {
        const result = canonicalize({ a: 1 }, opts);
        expect(result).toBe('{\n  "a": 1\n}\n');
      } finally {
        spy.mockRestore();
      }
    });

    it("should handle safe JSON parsing", () => {
      const valid = safeParseJson('{"valid": true}');
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data).toEqual({ valid: true });
      }

      const invalid = safeParseJson("{invalid");
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error).toBeTruthy();
      }
    });
  });

  describe("Concurrency", () => {
    it("should format multiple documents concurrently", async () => {
      const store = openStore({ root: testDir, formatConcurrency: 4 });

      // Create many documents
      for (let i = 0; i < 20; i++) {
        await store.put({ type: "task", id: `t${i}` }, { type: "task", id: `t${i}`, index: i });
      }

      // Manually corrupt some
      for (let i = 0; i < 5; i++) {
        await writeFile(
          join(testDir, "task", `t${i}.json`),
          `{"type":"task","id":"t${i}","index":${i},"z":"last"}`,
          "utf-8"
        );
      }

      const start = Date.now();
      const count = await store.format({ type: "task" });
      const duration = Date.now() - start;

      expect(count).toBe(5);
      expect(duration).toBeLessThan(2000); // Should be fast with concurrency

      await store.close();
    });
  });
});
