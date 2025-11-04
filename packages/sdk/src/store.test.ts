import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.js";
import type { Store, Document, Key } from "./types.js";

describe("Store CRUD operations", () => {
  let testDir: string;
  let store: Store;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-test-"));
    store = openStore({ root: testDir });
  });

  afterEach(async () => {
    await store.close();
    // Clean up temp directory after each test
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("put()", () => {
    it("should store a new document", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "user", id: "alice", name: "Alice" };

      await store.put(key, doc);

      const result = await store.get(key);
      expect(result).toEqual(doc);
    });

    it("should update an existing document", async () => {
      const key: Key = { type: "user", id: "bob" };
      const doc1: Document = { type: "user", id: "bob", name: "Bob" };
      const doc2: Document = { type: "user", id: "bob", name: "Robert" };

      await store.put(key, doc1);
      await store.put(key, doc2);

      const result = await store.get(key);
      expect(result).toEqual(doc2);
    });

    it("should validate key type matches document type", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "post", id: "alice", title: "Test" };

      await expect(store.put(key, doc)).rejects.toThrow(
        'Document type "post" does not match key type "user"'
      );
    });

    it("should validate key id matches document id", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "user", id: "bob", name: "Bob" };

      await expect(store.put(key, doc)).rejects.toThrow(
        'Document id "bob" does not match key id "alice"'
      );
    });

    it("should validate key type contains valid characters", async () => {
      const key: Key = { type: "user/../secret", id: "alice" };
      const doc: Document = { type: "user/../secret", id: "alice", name: "Alice" };

      await expect(store.put(key, doc)).rejects.toThrow("type contains invalid characters");
    });

    it("should validate key id contains valid characters", async () => {
      const key: Key = { type: "user", id: "../etc/passwd" };
      const doc: Document = { type: "user", id: "../etc/passwd", name: "Hacker" };

      await expect(store.put(key, doc)).rejects.toThrow("id contains invalid characters");
    });

    it("should format document with stable key order", async () => {
      const key: Key = { type: "user", id: "charlie" };
      const doc: Document = { id: "charlie", type: "user", z: "last", a: "first" };

      await store.put(key, doc);

      // Read raw file content
      const filePath = join(testDir, "user", "charlie.json");
      const content = await readFile(filePath, "utf-8");

      // Keys should be alphabetically sorted
      const lines = content.trim().split("\n");
      expect(lines[1]).toContain('"a"');
      expect(lines[2]).toContain('"id"');
      expect(lines[3]).toContain('"type"');
      expect(lines[4]).toContain('"z"');
    });

    it("should add trailing newline to formatted document", async () => {
      const key: Key = { type: "user", id: "dave" };
      const doc: Document = { type: "user", id: "dave", name: "Dave" };

      await store.put(key, doc);

      const filePath = join(testDir, "user", "dave.json");
      const content = await readFile(filePath, "utf-8");

      expect(content.endsWith("\n")).toBe(true);
    });

    it("should not modify file if document unchanged (no-op write)", async () => {
      const key: Key = { type: "user", id: "eve" };
      const doc: Document = { type: "user", id: "eve", name: "Eve" };

      // First write
      await store.put(key, doc);
      const filePath = join(testDir, "user", "eve.json");
      const stat1 = await stat(filePath);

      // Wait a bit to ensure mtime would change if file was written
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second write with same document
      await store.put(key, doc);
      const stat2 = await stat(filePath);

      // File should not have been modified
      expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
    });

    it("should invalidate cache after put", async () => {
      const key: Key = { type: "user", id: "frank" };
      const doc1: Document = { type: "user", id: "frank", name: "Frank" };
      const doc2: Document = { type: "user", id: "frank", name: "Franklin" };

      await store.put(key, doc1);
      await store.get(key); // Warm cache

      await store.put(key, doc2);

      // Cache should be updated with new document
      const result = await store.get(key);
      expect(result).toEqual(doc2);
    });
  });

  describe("get()", () => {
    it("should retrieve an existing document", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "user", id: "alice", name: "Alice" };

      await store.put(key, doc);
      const result = await store.get(key);

      expect(result).toEqual(doc);
    });

    it("should return null for non-existent document", async () => {
      const key: Key = { type: "user", id: "nonexistent" };

      const result = await store.get(key);

      expect(result).toBeNull();
    });

    it("should use cache for second read (cache hit)", async () => {
      const key: Key = { type: "user", id: "bob" };
      const doc: Document = { type: "user", id: "bob", name: "Bob" };

      await store.put(key, doc);

      // Spy on readDocument to verify caching behavior
      const { vi } = await import("vitest");
      const readSpy = vi.spyOn(await import("./io.js"), "readDocument");

      // First read - cache miss (should read from disk)
      const result1 = await store.get(key);
      expect(result1).toEqual(doc);
      const firstCallCount = readSpy.mock.calls.length;

      // Second read - should be cache hit (should NOT read from disk again)
      const result2 = await store.get(key);
      expect(result2).toEqual(doc);
      expect(readSpy.mock.calls.length).toBe(firstCallCount); // No additional disk read

      readSpy.mockRestore();
    });

    it("should throw error for invalid JSON", async () => {
      const key: Key = { type: "user", id: "invalid" };
      const filePath = join(testDir, "user", "invalid.json");

      // Manually create invalid JSON file
      const { atomicWrite } = await import("./io.js");
      await atomicWrite(filePath, "{ invalid json }");

      await expect(store.get(key)).rejects.toThrow("Failed to parse JSON document");
    });

    it("should throw error for document with mismatched type", async () => {
      const key: Key = { type: "user", id: "mismatch" };
      const filePath = join(testDir, "user", "mismatch.json");

      // Manually create document with wrong type
      const { atomicWrite } = await import("./io.js");
      await atomicWrite(filePath, JSON.stringify({ type: "post", id: "mismatch" }));

      await expect(store.get(key)).rejects.toThrow("Document validation failed");
    });

    it("should throw error for document with mismatched id", async () => {
      const key: Key = { type: "user", id: "alice" };
      const filePath = join(testDir, "user", "alice.json");

      // Manually create document with wrong id
      const { atomicWrite } = await import("./io.js");
      await atomicWrite(filePath, JSON.stringify({ type: "user", id: "bob" }));

      await expect(store.get(key)).rejects.toThrow("Document validation failed");
    });

    it("should validate key before attempting read", async () => {
      const key: Key = { type: "user/../secret", id: "alice" };

      await expect(store.get(key)).rejects.toThrow("type contains invalid characters");
    });
  });

  describe("remove()", () => {
    it("should remove an existing document", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "user", id: "alice", name: "Alice" };

      await store.put(key, doc);
      await store.remove(key);

      const result = await store.get(key);
      expect(result).toBeNull();
    });

    it("should be idempotent (removing non-existent document succeeds)", async () => {
      const key: Key = { type: "user", id: "nonexistent" };

      // Should not throw
      await expect(store.remove(key)).resolves.toBeUndefined();
    });

    it("should invalidate cache after remove", async () => {
      const key: Key = { type: "user", id: "bob" };
      const doc: Document = { type: "user", id: "bob", name: "Bob" };

      await store.put(key, doc);
      await store.get(key); // Warm cache

      await store.remove(key);

      // Should return null, not cached value
      const result = await store.get(key);
      expect(result).toBeNull();
    });

    it("should validate key before attempting remove", async () => {
      const key: Key = { type: "user/../secret", id: "alice" };

      await expect(store.remove(key)).rejects.toThrow("type contains invalid characters");
    });
  });

  describe("list()", () => {
    it("should return empty array for non-existent type", async () => {
      const result = await store.list("nonexistent");

      expect(result).toEqual([]);
    });

    it("should return all document IDs for a type", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });
      await store.put(
        { type: "user", id: "charlie" },
        { type: "user", id: "charlie", name: "Charlie" }
      );

      const result = await store.list("user");

      expect(result).toEqual(["alice", "bob", "charlie"]);
    });

    it("should return sorted IDs", async () => {
      await store.put({ type: "user", id: "zebra" }, { type: "user", id: "zebra", name: "Zebra" });
      await store.put({ type: "user", id: "alpha" }, { type: "user", id: "alpha", name: "Alpha" });
      await store.put({ type: "user", id: "mike" }, { type: "user", id: "mike", name: "Mike" });

      const result = await store.list("user");

      expect(result).toEqual(["alpha", "mike", "zebra"]);
    });

    it("should not include documents from other types", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Post" });

      const result = await store.list("user");

      expect(result).toEqual(["alice"]);
    });

    it("should validate type name", async () => {
      await expect(store.list("user/../secret")).rejects.toThrow(
        "type contains invalid characters"
      );
    });

    it("should return empty array for type with no documents", async () => {
      // Create another type with documents
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      // Query different type
      const result = await store.list("post");

      expect(result).toEqual([]);
    });

    it("should filter out non-json files", async () => {
      // Create some .json files and a .txt file
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });

      // Manually create a non-.json file
      const { atomicWrite } = await import("./io.js");
      const txtPath = join(testDir, "user", "readme.txt");
      await atomicWrite(txtPath, "This is not a JSON file");

      const result = await store.list("user");

      // Should only include .json files
      expect(result).toEqual(["alice", "bob"]);
      expect(result).not.toContain("readme");
    });
  });

  describe("formatting consistency", () => {
    it("should produce identical output for re-saved unchanged document", async () => {
      const key: Key = { type: "user", id: "test" };
      const doc: Document = { type: "user", id: "test", name: "Test", age: 30 };

      await store.put(key, doc);
      const filePath = join(testDir, "user", "test.json");
      const content1 = await readFile(filePath, "utf-8");

      await store.put(key, doc);
      const content2 = await readFile(filePath, "utf-8");

      // Content should be byte-identical
      expect(content2).toBe(content1);
    });

    it("should use custom indent setting", async () => {
      const customStore = openStore({ root: testDir, indent: 4 });
      const key: Key = { type: "user", id: "indent-test" };
      const doc: Document = { type: "user", id: "indent-test", name: "Test" };

      await customStore.put(key, doc);

      const filePath = join(testDir, "user", "indent-test.json");
      const content = await readFile(filePath, "utf-8");

      // Should use 4-space indentation
      expect(content).toContain('    "');
      // Check for 4 spaces specifically (not 2 spaces at start of key lines)
      const lines = content.split("\n");
      const keyLines = lines.filter((l) => l.includes('"id"') || l.includes('"name"'));
      expect(keyLines.every((l) => l.startsWith("    "))).toBe(true);

      await customStore.close();
    });
  });

  describe("error messages", () => {
    it("should include absolute file path in read errors", async () => {
      const key: Key = { type: "user", id: "invalid" };
      const filePath = join(testDir, "user", "invalid.json");

      // Create invalid JSON
      const { atomicWrite } = await import("./io.js");
      await atomicWrite(filePath, "{ invalid }");

      try {
        await store.get(key);
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).toContain("Failed to parse JSON document at");
        expect(err.message).toContain(filePath);
      }
    });

    it("should include validation error details", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "post", id: "alice", title: "Test" } as any;

      try {
        await store.put(key, doc);
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).toContain("type");
        expect(err.message).toContain("post");
        expect(err.message).toContain("user");
      }
    });

    it("should reject documents with invalid structure (null)", async () => {
      const key: Key = { type: "user", id: "invalid-null" };
      const filePath = join(testDir, "user", "invalid-null.json");

      // Create document with null
      const { atomicWrite } = await import("./io.js");
      await atomicWrite(filePath, "null");

      await expect(store.get(key)).rejects.toThrow("Document must be an object");
    });

    it("should reject documents with invalid structure (empty object missing type/id)", async () => {
      const key: Key = { type: "user", id: "invalid-empty" };
      const filePath = join(testDir, "user", "invalid-empty.json");

      // Create empty object
      const { atomicWrite } = await import("./io.js");
      await atomicWrite(filePath, "{}");

      await expect(store.get(key)).rejects.toThrow("Document validation failed");
    });

    it("should propagate read errors from put() no-op check", async () => {
      const key: Key = { type: "user", id: "read-error" };
      const doc: Document = { type: "user", id: "read-error", name: "Test" };

      // Create a directory with the target file name to cause read error
      const filePath = join(testDir, "user", "read-error.json");
      const { ensureDirectory } = await import("./io.js");
      await ensureDirectory(filePath); // Create directory instead of file

      // Should propagate the read error, not silently continue
      await expect(store.put(key, doc)).rejects.toThrow();
    });

    it("should reject null documents", async () => {
      const key: Key = { type: "user", id: "null-doc" };

      await expect(store.put(key, null as any)).rejects.toThrow("Document must be an object");
    });

    it("should reject array documents", async () => {
      const key: Key = { type: "user", id: "array-doc" };

      // Arrays don't have type/id properties, so validation catches it
      await expect(store.put(key, [] as any)).rejects.toThrow();
    });

    it("should propagate remove errors when target is a directory", async () => {
      const key: Key = { type: "user", id: "dir-remove" };

      // Create a directory with the target name
      const filePath = join(testDir, "user", "dir-remove.json");
      const { ensureDirectory } = await import("./io.js");
      await ensureDirectory(filePath);

      // Should propagate the error
      await expect(store.remove(key)).rejects.toThrow();
    });
  });

  describe("concurrent operations", () => {
    it("should handle concurrent puts to different documents", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.put(
          { type: "user", id: `user${i}` },
          { type: "user", id: `user${i}`, name: `User ${i}` }
        )
      );

      await Promise.all(promises);

      const ids = await store.list("user");
      expect(ids).toHaveLength(10);
    });

    it("should handle concurrent puts to same document (last-writer-wins)", async () => {
      const key: Key = { type: "user", id: "concurrent" };

      const promises = Array.from({ length: 50 }, (_, i) =>
        store.put(key, { type: "user", id: "concurrent", version: i })
      );

      await Promise.all(promises);

      const result = await store.get(key);
      expect(result).toBeDefined();
      expect(result?.type).toBe("user");
      expect(result?.id).toBe("concurrent");
      // One of the writes should have won - verify it's a valid version number
      expect(typeof (result as any).version).toBe("number");
      expect((result as any).version).toBeGreaterThanOrEqual(0);
      expect((result as any).version).toBeLessThan(50);
    });
  });

  describe("cache integration", () => {
    it("should invalidate cache after put", async () => {
      const key: Key = { type: "user", id: "cache-test" };
      const doc1: Document = { type: "user", id: "cache-test", version: 1 };
      const doc2: Document = { type: "user", id: "cache-test", version: 2 };

      await store.put(key, doc1);
      await store.get(key); // Warm cache

      await store.put(key, doc2);
      const result = await store.get(key);

      expect(result).toEqual(doc2);
    });

    it("should invalidate cache after remove", async () => {
      const key: Key = { type: "user", id: "remove-test" };
      const doc: Document = { type: "user", id: "remove-test", name: "Test" };

      await store.put(key, doc);
      await store.get(key); // Warm cache

      await store.remove(key);
      const result = await store.get(key);

      expect(result).toBeNull();
    });
  });
});
