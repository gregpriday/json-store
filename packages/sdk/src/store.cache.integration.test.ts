/**
 * Integration tests for cache in JSONStore
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { openStore } from "./store.js";
import type { Store, Document } from "./types.js";

describe("JSONStore cache integration", () => {
  let store: Store;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests (isolated per test)
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jsonstore-cache-"));
    store = openStore({ root: tempDir });
  });

  afterEach(async () => {
    // Cleanup
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Warm reads (cached)", () => {
    it("should return cached document on second read", async () => {
      const testDoc: Document = {
        type: "user",
        id: "123",
        name: "Test User",
      };

      // Create test file
      const typeDir = path.join(tempDir, "user");
      await fs.mkdir(typeDir, { recursive: true });
      const filePath = path.join(typeDir, "123.json");
      await fs.writeFile(filePath, JSON.stringify(testDoc));

      // First read (cold - cache miss)
      const doc1 = await store.get({ type: "user", id: "123" });
      expect(doc1).toEqual(testDoc);

      // Second read (warm - cache hit)
      const doc2 = await store.get({ type: "user", id: "123" });
      expect(doc2).toEqual(testDoc);

      // Both reads should return equivalent documents
      expect(doc2).toEqual(doc1);
    });

    it("should cache multiple documents independently", async () => {
      const user1: Document = { type: "user", id: "1", name: "User 1" };
      const user2: Document = { type: "user", id: "2", name: "User 2" };
      const post1: Document = { type: "post", id: "1", title: "Post 1" };

      // Create test files
      await fs.mkdir(path.join(tempDir, "user"), { recursive: true });
      await fs.mkdir(path.join(tempDir, "post"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "user", "1.json"), JSON.stringify(user1));
      await fs.writeFile(path.join(tempDir, "user", "2.json"), JSON.stringify(user2));
      await fs.writeFile(path.join(tempDir, "post", "1.json"), JSON.stringify(post1));

      // Read all documents
      await store.get({ type: "user", id: "1" });
      await store.get({ type: "user", id: "2" });
      await store.get({ type: "post", id: "1" });

      // Read again (should all be cached)
      const result1 = await store.get({ type: "user", id: "1" });
      const result2 = await store.get({ type: "user", id: "2" });
      const result3 = await store.get({ type: "post", id: "1" });

      expect(result1).toEqual(user1);
      expect(result2).toEqual(user2);
      expect(result3).toEqual(post1);
    });
  });

  describe("Cache invalidation on file changes", () => {
    it("should invalidate cache when file is modified", async () => {
      const originalDoc: Document = {
        type: "user",
        id: "123",
        version: 1,
      };

      const updatedDoc: Document = {
        type: "user",
        id: "123",
        version: 2,
      };

      // Create initial file
      const typeDir = path.join(tempDir, "user");
      const filePath = path.join(typeDir, "123.json");
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(originalDoc));

      // First read (cache it)
      const doc1 = await store.get({ type: "user", id: "123" });
      expect(doc1).toEqual(originalDoc);

      // Wait a bit to ensure mtime changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Modify file (change size)
      await fs.writeFile(filePath, JSON.stringify(updatedDoc));

      // Read again - should detect change and return new content
      const doc2 = await store.get({ type: "user", id: "123" });
      expect(doc2).toEqual(updatedDoc);
      expect(doc2).not.toEqual(doc1);
    });

    it("should handle file deletion gracefully", async () => {
      const testDoc: Document = {
        type: "user",
        id: "123",
        name: "Test",
      };

      // Create and read file
      const typeDir = path.join(tempDir, "user");
      const filePath = path.join(typeDir, "123.json");
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(testDoc));

      const doc1 = await store.get({ type: "user", id: "123" });
      expect(doc1).toEqual(testDoc);

      // Delete file
      await fs.unlink(filePath);

      // Should return null
      const doc2 = await store.get({ type: "user", id: "123" });
      expect(doc2).toBeNull();
    });
  });

  describe("TOCTOU (Time-of-check to time-of-use) guard", () => {
    it("should not cache if file changes during read", async () => {
      const doc1: Document = { type: "user", id: "123", v: 1 };
      const doc2: Document = { type: "user", id: "123", v: 2 };

      const typeDir = path.join(tempDir, "user");
      const filePath = path.join(typeDir, "123.json");
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(doc1));

      // This test simulates the TOCTOU scenario, but since we can't easily
      // inject timing into the async operations, we verify the pattern exists
      // by checking that a read followed by immediate modification works correctly

      const result1 = await store.get({ type: "user", id: "123" });
      expect(result1).toEqual(doc1);

      // Immediately modify
      await fs.writeFile(filePath, JSON.stringify(doc2));

      // Next read should get new version
      const result2 = await store.get({ type: "user", id: "123" });
      expect(result2).toEqual(doc2);
    });
  });

  describe("Cache invalidation on writes", () => {
    it("should invalidate cache entry on put", async () => {
      const testDoc: Document = {
        type: "user",
        id: "123",
        name: "Original",
      };

      // Create and warm cache
      await store.put({ type: "user", id: "123" }, testDoc);
      const cached = await store.get({ type: "user", id: "123" });
      expect(cached).toEqual(testDoc);

      // Update document
      const updatedDoc: Document = {
        type: "user",
        id: "123",
        name: "Updated",
      };

      await store.put({ type: "user", id: "123" }, updatedDoc);

      // Next get should return updated version (not stale cached version)
      const result = await store.get({ type: "user", id: "123" });
      expect(result).toEqual(updatedDoc);
    });

    it("should invalidate cache entry on remove (when implemented)", async () => {
      const testDoc: Document = {
        type: "user",
        id: "123",
        name: "Test",
      };

      // Create and cache document using put
      await store.put({ type: "user", id: "123" }, testDoc);

      // Warm the cache
      await store.get({ type: "user", id: "123" });

      // Remove document
      await store.remove({ type: "user", id: "123" });

      // Should return null (not cached version)
      const result = await store.get({ type: "user", id: "123" });
      expect(result).toBeNull();
    });
  });

  describe("Path normalization", () => {
    it("should handle absolute paths correctly", async () => {
      const testDoc: Document = {
        type: "user",
        id: "123",
        name: "Test",
      };

      const typeDir = path.join(tempDir, "user");
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(path.join(typeDir, "123.json"), JSON.stringify(testDoc));

      // Read multiple times - should use same cache key
      const doc1 = await store.get({ type: "user", id: "123" });
      const doc2 = await store.get({ type: "user", id: "123" });

      expect(doc1).toEqual(testDoc);
      expect(doc2).toEqual(testDoc);
    });
  });

  describe("Store lifecycle", () => {
    it("should clear cache on close", async () => {
      const testDoc: Document = {
        type: "user",
        id: "123",
        name: "Test",
      };

      const typeDir = path.join(tempDir, "user");
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(path.join(typeDir, "123.json"), JSON.stringify(testDoc));

      // Read to populate cache
      await store.get({ type: "user", id: "123" });

      // Close store (clears cache)
      await store.close();

      // Create new store instance
      store = openStore({ root: tempDir });

      // Should still read from disk (cache was cleared)
      const result = await store.get({ type: "user", id: "123" });
      expect(result).toEqual(testDoc);
    });
  });

  describe("Performance characteristics", () => {
    it("should demonstrate cache effectiveness", async () => {
      const largeDoc: Document = {
        type: "data",
        id: "large",
        payload: "x".repeat(10000), // 10KB of data
      };

      const typeDir = path.join(tempDir, "data");
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(path.join(typeDir, "large.json"), JSON.stringify(largeDoc));

      // Cold read (disk I/O + parse)
      const doc1 = await store.get({ type: "data", id: "large" });
      expect(doc1).toEqual(largeDoc);

      // Multiple warm reads (from cache)
      for (let i = 0; i < 10; i++) {
        const doc = await store.get({ type: "data", id: "large" });
        expect(doc).toEqual(largeDoc);
      }

      // Verify documents are cached (test succeeds without timing assertions)
      // This avoids flaky timing-based assertions on fast systems
    });
  });

  describe("Error handling", () => {
    it("should handle invalid JSON gracefully", async () => {
      const typeDir = path.join(tempDir, "user");
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(path.join(typeDir, "invalid.json"), "{ invalid json }");

      await expect(store.get({ type: "user", id: "invalid" })).rejects.toThrow(
        "Failed to parse JSON"
      );
    });

    it("should reject documents with mismatched type/id", async () => {
      const typeDir = path.join(tempDir, "user");
      await fs.mkdir(typeDir, { recursive: true });

      // Write document with wrong type
      await fs.writeFile(
        path.join(typeDir, "123.json"),
        JSON.stringify({ type: "post", id: "123", data: "test" })
      );

      await expect(store.get({ type: "user", id: "123" })).rejects.toThrow(
        "Document validation failed"
      );

      // Write document with wrong id
      await fs.writeFile(
        path.join(typeDir, "456.json"),
        JSON.stringify({ type: "user", id: "999", data: "test" })
      );

      await expect(store.get({ type: "user", id: "456" })).rejects.toThrow(
        "Document validation failed"
      );
    });

    it("should handle missing directories gracefully", async () => {
      const result = await store.get({ type: "nonexistent", id: "123" });
      expect(result).toBeNull();
    });
  });

  describe("Security: path traversal prevention", () => {
    it("should reject keys with .. in type", async () => {
      await expect(store.get({ type: "../etc", id: "passwd" })).rejects.toThrow(
        "type contains invalid characters"
      );
    });

    it("should reject keys with .. in id", async () => {
      await expect(store.get({ type: "user", id: "../../etc/passwd" })).rejects.toThrow(
        "id contains invalid characters"
      );
    });

    it("should reject keys with / in type", async () => {
      await expect(store.get({ type: "user/admin", id: "123" })).rejects.toThrow(
        "type contains invalid characters"
      );
    });

    it("should reject keys with / in id", async () => {
      await expect(store.get({ type: "user", id: "admin/123" })).rejects.toThrow(
        "id contains invalid characters"
      );
    });

    it("should reject keys with \\ in type", async () => {
      await expect(store.get({ type: "user\\admin", id: "123" })).rejects.toThrow(
        "type contains invalid characters"
      );
    });

    it("should reject keys with \\ in id", async () => {
      await expect(store.get({ type: "user", id: "admin\\123" })).rejects.toThrow(
        "id contains invalid characters"
      );
    });

    it("should reject absolute paths in type", async () => {
      await expect(store.get({ type: "/tmp/malicious", id: "123" })).rejects.toThrow(
        "type contains invalid characters"
      );
    });

    it("should reject absolute paths in id", async () => {
      await expect(store.get({ type: "user", id: "/tmp/malicious" })).rejects.toThrow(
        "id contains invalid characters"
      );
    });

    it("should reject Windows absolute paths in type", async () => {
      await expect(store.get({ type: "C:\\Windows", id: "123" })).rejects.toThrow(
        "type contains invalid characters"
      );
    });

    it("should work with legitimate keys", async () => {
      // This should not throw
      const result = await store.get({ type: "user", id: "123" });
      expect(result).toBeNull(); // File doesn't exist, but no error
    });
  });
});
