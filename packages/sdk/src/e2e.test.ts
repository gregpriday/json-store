/**
 * End-to-end integration tests for SDK
 * Tests complete workflows and system integration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.js";
import type { Store } from "./types.js";
import { stableStringify } from "./format.js";

describe("SDK End-to-End Integration Tests", () => {
  let store: Store;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `jsonstore-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testDir = await mkdtemp(testDir);
    store = openStore({ root: testDir });
  });

  afterEach(async () => {
    await store.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Complete CRUD Lifecycle", () => {
    it("should handle full CRUD workflow with filtering and sorting", async () => {
      // 1. Put multiple documents
      await store.put(
        { type: "task", id: "task-1" },
        { type: "task", id: "task-1", title: "First Task", status: "open", priority: 5 }
      );
      await store.put(
        { type: "task", id: "task-2" },
        { type: "task", id: "task-2", title: "Second Task", status: "ready", priority: 8 }
      );
      await store.put(
        { type: "task", id: "task-3" },
        { type: "task", id: "task-3", title: "Third Task", status: "open", priority: 3 }
      );

      // 2. List documents
      const ids = await store.list("task");
      expect(ids).toHaveLength(3);
      expect(ids).toContain("task-1");
      expect(ids).toContain("task-2");
      expect(ids).toContain("task-3");

      // 3. Query documents with explicit $eq operator
      const openTasks = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
        sort: { priority: -1 },
      });
      expect(openTasks).toHaveLength(2);
      expect(openTasks[0].priority).toBe(5);
      expect(openTasks[1].priority).toBe(3);

      // 4. Update document
      await store.put(
        { type: "task", id: "task-1" },
        { type: "task", id: "task-1", title: "Updated Task", status: "closed", priority: 5 }
      );

      // 5. Query again (should exclude updated doc)
      const openTasksAfter = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });
      expect(openTasksAfter).toHaveLength(1);
      expect(openTasksAfter[0].id).toBe("task-3");

      // 6. Get specific document
      const task = await store.get({ type: "task", id: "task-1" });
      expect(task?.status).toBe("closed");

      // 7. Remove document
      await store.remove({ type: "task", id: "task-1" });

      // 8. Verify removal
      const deleted = await store.get({ type: "task", id: "task-1" });
      expect(deleted).toBeNull();

      // 9. Stats
      const stats = await store.stats("task");
      expect(stats.count).toBe(2);
    });
  });

  describe("Multi-Type Operations", () => {
    it("should handle multiple types correctly", async () => {
      // Add different types
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1", title: "Task" });
      await store.put({ type: "note", id: "1" }, { type: "note", id: "1", title: "Note" });
      await store.put({ type: "project", id: "1" }, { type: "project", id: "1", title: "Project" });

      // Query across all types using $exists
      const all = await store.query({
        filter: { title: { $exists: true } },
      });
      expect(all).toHaveLength(3);

      // Stats for all
      const stats = await store.stats();
      expect(stats.count).toBe(3);
    });
  });

  describe("Array and Nested Field Queries", () => {
    beforeEach(async () => {
      // Create documents with arrays and nested fields
      await store.put(
        { type: "user", id: "user-1" },
        {
          type: "user",
          id: "user-1",
          name: "Alice",
          tags: ["admin", "developer"],
          meta: { owner: { email: "alice@example.com" }, verified: true },
        }
      );
      await store.put(
        { type: "user", id: "user-2" },
        {
          type: "user",
          id: "user-2",
          name: "Bob",
          tags: ["developer"],
          meta: { owner: { email: "bob@example.com" }, verified: false },
        }
      );
      await store.put(
        { type: "user", id: "user-3" },
        {
          type: "user",
          id: "user-3",
          name: "Charlie",
          tags: [],
          meta: { owner: { email: "charlie@example.com" } },
        }
      );
    });

    it("should query array fields with $eq (containment)", async () => {
      const results = await store.query({
        type: "user",
        filter: { tags: { $eq: "admin" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("user-1");
    });

    it("should query nested fields with dot notation", async () => {
      const results = await store.query({
        type: "user",
        filter: { "meta.owner.email": { $eq: "bob@example.com" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("user-2");
    });

    it("should handle nested boolean fields", async () => {
      const verified = await store.query({
        type: "user",
        filter: { "meta.verified": { $eq: true } },
      });

      expect(verified).toHaveLength(1);
      expect(verified[0].id).toBe("user-1");

      const unverified = await store.query({
        type: "user",
        filter: { "meta.verified": { $eq: false } },
      });

      expect(unverified).toHaveLength(1);
      expect(unverified[0].id).toBe("user-2");
    });

    it("should handle $exists on nested fields", async () => {
      const withVerified = await store.query({
        type: "user",
        filter: { "meta.verified": { $exists: true } },
      });

      expect(withVerified).toHaveLength(2);

      const withoutVerified = await store.query({
        type: "user",
        filter: { "meta.verified": { $exists: false } },
      });

      expect(withoutVerified).toHaveLength(1);
      expect(withoutVerified[0].id).toBe("user-3");
    });

    it("should handle empty arrays", async () => {
      const emptyTags = await store.query({
        type: "user",
        filter: { tags: { $eq: [] } },
      });

      // Empty array should not match $eq with empty array literal
      // This tests the array containment semantics
      expect(emptyTags).toHaveLength(0);
    });

    it("should handle null values in queries", async () => {
      await store.put({ type: "user", id: "user-null" }, {
        type: "user",
        id: "user-null",
        name: "Null User",
        description: null,
      } as any);

      const results = await store.query({
        type: "user",
        filter: { description: { $eq: null } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("user-null");
    });
  });

  describe("Complex Queries with DSL Operators", () => {
    beforeEach(async () => {
      // Create deterministic test dataset
      for (let i = 1; i <= 100; i++) {
        await store.put(
          { type: "task", id: `task-${i}` },
          {
            type: "task",
            id: `task-${i}`,
            title: `Task ${i}`,
            status: i % 3 === 0 ? "closed" : i % 2 === 0 ? "ready" : "open",
            priority: i % 10, // Deterministic 0-9
            tags: [`tag-${i % 5}`],
          }
        );
      }
    });

    it("should handle complex filter with $and, $in, and $gte", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $and: [{ status: { $in: ["open", "ready"] } }, { priority: { $gte: 5 } }],
        },
        sort: { priority: -1, title: 1 },
        projection: { id: 1, title: 1, priority: 1 },
        limit: 20,
        skip: 5,
      });

      expect(results.length).toBeLessThanOrEqual(20);
      // Projection should exclude status
      expect(results[0]).not.toHaveProperty("status");
      expect(results[0]).toHaveProperty("priority");

      // Verify all results match filter
      for (const doc of results) {
        expect(doc.priority).toBeGreaterThanOrEqual(5);
      }
    });

    it("should handle $or operator", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $or: [{ status: { $eq: "closed" } }, { priority: { $gte: 9 } }],
        },
      });

      // Verify each result matches at least one condition
      for (const doc of results) {
        const matchesStatus = doc.status === "closed";
        const matchesPriority = typeof doc.priority === "number" && doc.priority >= 9;
        expect(matchesStatus || matchesPriority).toBe(true);
      }
    });

    it("should handle $not operator", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $not: { status: { $eq: "open" } },
        },
      });

      // No result should have status "open"
      for (const doc of results) {
        expect(doc.status).not.toBe("open");
      }
    });

    it("should handle $ne operator", async () => {
      const results = await store.query({
        type: "task",
        filter: { status: { $ne: "open" } },
      });

      // All results should not have status "open"
      for (const doc of results) {
        expect(doc.status).not.toBe("open");
      }
      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle $nin operator", async () => {
      const results = await store.query({
        type: "task",
        filter: { status: { $nin: ["open", "closed"] } },
      });

      // All results should have status "ready"
      for (const doc of results) {
        expect(doc.status).toBe("ready");
      }
    });

    it("should handle $gt and $lt operators", async () => {
      const gtResults = await store.query({
        type: "task",
        filter: { priority: { $gt: 5 } },
      });

      for (const doc of gtResults) {
        expect(doc.priority).toBeGreaterThan(5);
      }

      const ltResults = await store.query({
        type: "task",
        filter: { priority: { $lt: 3 } },
      });

      for (const doc of ltResults) {
        expect(doc.priority).toBeLessThan(3);
      }
    });

    it("should handle $lte operator", async () => {
      const results = await store.query({
        type: "task",
        filter: { priority: { $lte: 2 } },
      });

      for (const doc of results) {
        expect(doc.priority).toBeLessThanOrEqual(2);
      }
    });

    it("should handle $type operator", async () => {
      const results = await store.query({
        type: "task",
        filter: { priority: { $type: "number" } },
      });

      for (const doc of results) {
        expect(typeof doc.priority).toBe("number");
      }
      expect(results.length).toBe(100); // All tasks have numeric priority
    });

    it("should handle $exists operator with false", async () => {
      // Add a task without tags
      await store.put(
        { type: "task", id: "task-notags" },
        { type: "task", id: "task-notags", title: "No Tags", status: "open", priority: 5 }
      );

      const results = await store.query({
        type: "task",
        filter: { tags: { $exists: false } },
      });

      // Should find the task without tags
      expect(results.length).toBeGreaterThan(0);
      for (const doc of results) {
        expect(doc.tags).toBeUndefined();
      }
    });
  });

  describe("Index Performance", () => {
    it("should speed up queries with indexes", { timeout: 30000 }, async () => {
      // Create dataset (deterministic)
      for (let i = 1; i <= 1000; i++) {
        await store.put(
          { type: "task", id: `task-${i}` },
          {
            type: "task",
            id: `task-${i}`,
            status: i % 5 === 0 ? "closed" : "open",
          }
        );
      }

      // Query without index
      const resultsWithout = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      // Create index
      await store.ensureIndex("task", "status");

      // Verify index file exists
      const indexPath = join(testDir, "task", "_indexes", "status.json");
      const indexExists = await readFile(indexPath, "utf8");
      const indexData = JSON.parse(indexExists);
      expect(indexData).toHaveProperty("open");
      expect(indexData).toHaveProperty("closed");

      // Query with index
      const resultsWith = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      // Results should be identical
      expect(resultsWith.length).toBe(resultsWithout.length);
      expect(resultsWith.length).toBe(800); // 80% of 1000
      expect(indexData.open.length).toBe(800);
      expect(indexData.closed.length).toBe(200);
    });

    it("should persist indexes across store reopens", async () => {
      // Create dataset
      for (let i = 1; i <= 100; i++) {
        await store.put(
          { type: "task", id: `task-${i}` },
          {
            type: "task",
            id: `task-${i}`,
            status: i % 2 === 0 ? "open" : "closed",
          }
        );
      }

      // Create index
      await store.ensureIndex("task", "status");

      // Query with index
      const results1 = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      // Verify index file exists
      const indexPath = join(testDir, "task", "_indexes", "status.json");
      await expect(readFile(indexPath, "utf8")).resolves.toBeDefined();

      // Close and reopen store
      await store.close();
      store = openStore({ root: testDir });

      // Verify index file still exists after reopen
      await expect(readFile(indexPath, "utf8")).resolves.toBeDefined();

      // Query should still work with persisted index
      const results2 = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      // Results should be identical
      expect(results2.length).toBe(results1.length);
      expect(results2.length).toBe(50);
    });

    it("should handle empty query results", async () => {
      // Create dataset where no documents match
      for (let i = 1; i <= 10; i++) {
        await store.put(
          { type: "task", id: `task-${i}` },
          { type: "task", id: `task-${i}`, status: "open" }
        );
      }

      // Query for non-existent status
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "nonexistent" } },
      });

      expect(results).toEqual([]);
      expect(results.length).toBe(0);
    });
  });

  describe("Format Operations", () => {
    it("should format documents with stable key ordering", async () => {
      // Put document with unsorted keys
      await store.put({ type: "task", id: "1" }, {
        type: "task",
        id: "1",
        z: "last",
        a: "first",
        m: "middle",
      } as any);

      // The document is already formatted by put(), so format() returns 0
      // This actually tests idempotence, which is correct behavior
      const formatted = await store.format({ all: true });
      expect(formatted).toBe(0); // Already formatted

      // Read raw file and verify key ordering
      const filePath = join(testDir, "task", "1.json");
      const content = await readFile(filePath, "utf8");

      // Verify content matches stableStringify output
      const doc = { type: "task", id: "1", z: "last", a: "first", m: "middle" };
      const expected = stableStringify(doc, 2, "alpha");
      expect(content).toBe(expected);

      // Verify alphabetical ordering in file
      const lines = content.split("\n");
      expect(lines[1]).toContain('"a"');
      expect(lines[2]).toContain('"id"');
      expect(lines[3]).toContain('"m"');
      expect(lines[4]).toContain('"type"');
      expect(lines[5]).toContain('"z"');
    });

    it("should be idempotent on already-formatted documents", async () => {
      // Put document (already formatted by put())
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1", title: "Test" });

      // Format - should be no-op since put() already formatted
      const first = await store.format({ all: true });
      expect(first).toBe(0); // Already formatted

      // Format again - should still be no-op
      const second = await store.format({ all: true });
      expect(second).toBe(0); // No documents reformatted
    });
  });

  describe("Statistics", () => {
    it("should compute accurate statistics across types", async () => {
      // Create documents of different sizes
      await store.put({ type: "small", id: "1" }, { type: "small", id: "1", x: 1 });
      await store.put({ type: "small", id: "2" }, { type: "small", id: "2", x: 2 });
      await store.put(
        { type: "large", id: "1" },
        { type: "large", id: "1", data: "a".repeat(1000) }
      );

      // Get detailed stats
      const detailed = await store.detailedStats();
      expect(detailed.count).toBe(3);
      expect(detailed.types).toBeDefined();
      expect(detailed.types?.small.count).toBe(2);
      expect(detailed.types?.large.count).toBe(1);
      expect(detailed.avgBytes).toBeGreaterThan(0);
      expect(detailed.maxBytes).toBeGreaterThan(detailed.minBytes);
    });
  });
});
