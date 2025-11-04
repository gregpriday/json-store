import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.js";
import type { Store, Document, Key } from "./types.js";

describe("Store stats operations", () => {
  let testDir: string;
  let store: Store;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-stats-test-"));
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

  describe("stats() - basic functionality", () => {
    it("should return zero stats for empty store", async () => {
      const stats = await store.stats();
      expect(stats).toEqual({ count: 0, bytes: 0 });
    });

    it("should return stats for single document", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "user", id: "alice", name: "Alice" };
      await store.put(key, doc);

      const stats = await store.stats();
      expect(stats.count).toBe(1);
      expect(stats.bytes).toBeGreaterThan(0);
    });

    it("should return stats for multiple documents", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });

      const stats = await store.stats();
      expect(stats.count).toBe(3);
      expect(stats.bytes).toBeGreaterThan(0);
    });

    it("should return stats for specific type", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });

      const userStats = await store.stats("user");
      expect(userStats.count).toBe(2);

      const postStats = await store.stats("post");
      expect(postStats.count).toBe(1);
    });

    it("should return zero stats for non-existent type", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      const stats = await store.stats("nonexistent");
      expect(stats).toEqual({ count: 0, bytes: 0 });
    });

    it("should aggregate stats across all types", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });
      await store.put({ type: "comment", id: "c1" }, { type: "comment", id: "c1", text: "Nice!" });

      const allStats = await store.stats();
      const userStats = await store.stats("user");
      const postStats = await store.stats("post");
      const commentStats = await store.stats("comment");

      expect(allStats.count).toBe(userStats.count + postStats.count + commentStats.count);
      expect(allStats.bytes).toBe(userStats.bytes + postStats.bytes + commentStats.bytes);
    });
  });

  describe("stats() - accuracy", () => {
    it("should return accurate byte counts", async () => {
      const key: Key = { type: "user", id: "alice" };
      const doc: Document = { type: "user", id: "alice", name: "Alice" };
      await store.put(key, doc);

      const stats = await store.stats();
      const filePath = join(testDir, "user", "alice.json");
      const fileStats = await stat(filePath);

      expect(stats.bytes).toBe(fileStats.size);
    });

    it("should match document count from list()", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });
      await store.put(
        { type: "user", id: "charlie" },
        { type: "user", id: "charlie", name: "Charlie" }
      );

      const ids = await store.list("user");
      const stats = await store.stats("user");

      expect(stats.count).toBe(ids.length);
    });

    it("should update stats after put", async () => {
      const statsBefore = await store.stats();
      expect(statsBefore.count).toBe(0);

      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      const statsAfter = await store.stats();
      expect(statsAfter.count).toBe(1);
      expect(statsAfter.bytes).toBeGreaterThan(0);
    });

    it("should update stats after remove", async () => {
      const key: Key = { type: "user", id: "alice" };
      await store.put(key, { type: "user", id: "alice", name: "Alice" });

      const statsBefore = await store.stats();
      expect(statsBefore.count).toBe(1);

      await store.remove(key);

      const statsAfter = await store.stats();
      expect(statsAfter.count).toBe(0);
      expect(statsAfter.bytes).toBe(0);
    });
  });

  describe("stats() - edge cases", () => {
    it("should handle mixed types", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });
      await store.put({ type: "comment", id: "c1" }, { type: "comment", id: "c1", text: "Nice!" });

      const stats = await store.stats();
      expect(stats.count).toBe(3);
      expect(stats.bytes).toBeGreaterThan(0);
    });

    it("should handle empty type directories", async () => {
      // Create empty type directory
      await mkdir(join(testDir, "empty-type"));

      const stats = await store.stats("empty-type");
      expect(stats).toEqual({ count: 0, bytes: 0 });
    });

    it("should ignore _indexes directory", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      // Create _indexes directory
      await mkdir(join(testDir, "user", "_indexes"));
      await writeFile(join(testDir, "user", "_indexes", "name.json"), '{"Alice": ["alice"]}');

      const stats = await store.stats("user");
      expect(stats.count).toBe(1); // Should only count the document, not the index
    });

    it("should ignore non-JSON files", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      // Create non-JSON files
      await writeFile(join(testDir, "user", "readme.txt"), "Some readme");
      await writeFile(join(testDir, "user", ".hidden"), "Hidden file");

      const stats = await store.stats("user");
      expect(stats.count).toBe(1);
    });

    it("should ignore symlinks in type directory", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      // Create a symlink
      const targetPath = join(testDir, "user", "alice.json");
      const linkPath = join(testDir, "user", "link.json");

      try {
        await symlink(targetPath, linkPath);

        const stats = await store.stats("user");
        // Should only count the original file, not the symlink
        expect(stats.count).toBe(1);
      } catch (err: any) {
        // Skip test on platforms that don't support symlinks (Windows without admin)
        if (err.code === "EPERM" || err.code === "ENOSYS") {
          return;
        }
        throw err;
      }
    });

    it("should handle files with zero size", async () => {
      // Create a zero-byte JSON file
      await mkdir(join(testDir, "test"));
      await writeFile(join(testDir, "test", "empty.json"), "");

      const stats = await store.stats("test");
      expect(stats.count).toBe(1);
      expect(stats.bytes).toBe(0);
    });

    it("should handle large files", async () => {
      // Create a document with a large field
      const largeData = "x".repeat(1024 * 100); // 100KB of data
      await store.put(
        { type: "large", id: "doc1" },
        { type: "large", id: "doc1", data: largeData }
      );

      const stats = await store.stats("large");
      expect(stats.count).toBe(1);
      expect(stats.bytes).toBeGreaterThan(100000);
    });
  });

  describe("stats() - validation", () => {
    it("should validate type name for path traversal", async () => {
      await expect(store.stats("../etc")).rejects.toThrow("Type name cannot contain");
    });

    it("should validate type name for separators", async () => {
      await expect(store.stats("user/admin")).rejects.toThrow("Type name cannot contain");
    });

    it("should reject type names with colons", async () => {
      await expect(store.stats("C:\\Users")).rejects.toThrow("Type name cannot contain");
    });

    it("should reject type names starting with underscore", async () => {
      await expect(store.stats("_internal")).rejects.toThrow("Type name cannot start with");
    });

    it("should reject type names starting with dot", async () => {
      await expect(store.stats(".hidden")).rejects.toThrow("Type name cannot start with");
    });
  });

  describe("stats() - security", () => {
    it("should reject symlinked type directory pointing outside store root", async () => {
      // Create a type directory first
      await store.put({ type: "legit", id: "doc1" }, { type: "legit", id: "doc1", data: "ok" });

      // Create an external directory
      const externalDir = await mkdtemp(join(tmpdir(), "external-"));
      await writeFile(join(externalDir, "secret.json"), '{"secret": "data"}');

      // Try to symlink a type directory to external location
      try {
        await symlink(externalDir, join(testDir, "evil"));

        // Should return zero stats for the symlinked type directory (security: don't follow)
        const evilStats = await store.stats("evil");
        expect(evilStats).toEqual({ count: 0, bytes: 0 });

        // detailedStats should also exclude it from the types breakdown
        const detailed = await store.detailedStats();
        expect(detailed.types).not.toHaveProperty("evil");
      } catch (err: any) {
        // Skip test on platforms that don't support symlinks
        if (err.code === "EPERM" || err.code === "ENOSYS") {
          return;
        }
        throw err;
      } finally {
        await rm(externalDir, { recursive: true, force: true });
      }
    });

    it("should ignore .json file that is a symlink to external file", async () => {
      // Create external file
      const externalFile = join(tmpdir(), `external-${Date.now()}.json`);
      await writeFile(externalFile, '{"password": "hunter2"}');

      await mkdir(join(testDir, "user"));

      try {
        // Create symlink to external file
        await symlink(externalFile, join(testDir, "user", "hacker.json"));

        // Should not count the symlink
        const stats = await store.stats("user");
        expect(stats.count).toBe(0);
        expect(stats.bytes).toBe(0);
      } catch (err: any) {
        // Skip test on platforms that don't support symlinks
        if (err.code === "EPERM" || err.code === "ENOSYS") {
          return;
        }
        throw err;
      } finally {
        await rm(externalFile, { force: true });
      }
    });
  });

  describe("detailedStats()", () => {
    it("should return detailed stats for empty store", async () => {
      const stats = await store.detailedStats();
      expect(stats).toEqual({
        count: 0,
        bytes: 0,
        avgBytes: 0,
        minBytes: 0,
        maxBytes: 0,
        types: {},
      });
    });

    it("should return detailed stats for single document", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });

      const stats = await store.detailedStats();
      expect(stats.count).toBe(1);
      expect(stats.bytes).toBeGreaterThan(0);
      expect(stats.avgBytes).toBe(stats.bytes);
      expect(stats.minBytes).toBe(stats.bytes);
      expect(stats.maxBytes).toBe(stats.bytes);
      expect(stats.types).toHaveProperty("user");
      expect(stats.types!.user.count).toBe(1);
    });

    it("should calculate average size correctly", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "A" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });

      const stats = await store.detailedStats();
      expect(stats.avgBytes).toBe(stats.bytes / stats.count);
    });

    it("should track min and max sizes", async () => {
      // Small document
      await store.put({ type: "user", id: "a" }, { type: "user", id: "a", x: "1" });

      // Large document
      const largeData = "x".repeat(1000);
      await store.put({ type: "user", id: "b" }, { type: "user", id: "b", data: largeData });

      const stats = await store.detailedStats();
      expect(stats.minBytes).toBeLessThan(stats.maxBytes);
      expect(stats.minBytes).toBeGreaterThan(0);
      expect(stats.maxBytes).toBeGreaterThan(1000);
    });

    it("should provide per-type breakdown", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });

      const stats = await store.detailedStats();

      expect(stats.types).toHaveProperty("user");
      expect(stats.types).toHaveProperty("post");
      expect(stats.types!.user.count).toBe(2);
      expect(stats.types!.post.count).toBe(1);
    });

    it("should aggregate totals correctly", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "post", id: "post1" }, { type: "post", id: "post1", title: "Hello" });

      const stats = await store.detailedStats();
      const userBytes = stats.types!.user.bytes;
      const postBytes = stats.types!.post.bytes;

      expect(stats.bytes).toBe(userBytes + postBytes);
      expect(stats.count).toBe(2);
    });

    it("should handle mixed document sizes", async () => {
      await store.put({ type: "small", id: "s1" }, { type: "small", id: "s1", x: "a" });
      const mediumData = "x".repeat(500);
      await store.put({ type: "medium", id: "m1" }, { type: "medium", id: "m1", data: mediumData });
      const largeData = "x".repeat(5000);
      await store.put({ type: "large", id: "l1" }, { type: "large", id: "l1", data: largeData });

      const stats = await store.detailedStats();
      expect(stats.minBytes).toBeLessThan(stats.avgBytes);
      expect(stats.avgBytes).toBeLessThan(stats.maxBytes);
    });
  });

  describe("stats() - concurrent operations", () => {
    it("should handle concurrent reads", async () => {
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });

      // Run multiple stats calls concurrently
      const results = await Promise.all([store.stats(), store.stats(), store.stats()]);

      // All results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
    });

    it("should not throw on concurrent write during stats scan", async () => {
      // Create initial documents
      for (let i = 0; i < 10; i++) {
        await store.put(
          { type: "user", id: `user${i}` },
          { type: "user", id: `user${i}`, name: `User ${i}` }
        );
      }

      // Start stats scan and concurrent write
      const statsPromise = store.stats();
      const writePromise = store.put(
        { type: "user", id: "new" },
        { type: "user", id: "new", name: "New User" }
      );

      // Both should complete without errors
      const [stats] = await Promise.all([statsPromise, writePromise]);
      expect(stats.count).toBeGreaterThanOrEqual(10); // At least the original 10
    });

    it("should not throw on concurrent delete during stats scan", async () => {
      // Create initial documents
      for (let i = 0; i < 10; i++) {
        await store.put(
          { type: "user", id: `user${i}` },
          { type: "user", id: `user${i}`, name: `User ${i}` }
        );
      }

      // Start stats scan and concurrent delete
      const statsPromise = store.stats();
      const deletePromise = store.remove({ type: "user", id: "user5" });

      // Both should complete without errors
      const [stats] = await Promise.all([statsPromise, deletePromise]);
      expect(stats.count).toBeGreaterThanOrEqual(9); // Between 9 and 10
    });
  });
});
