/**
 * Unit tests for IndexManager
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IndexManager } from "./indexes.js";
import type { Document } from "./types.js";

const TEST_ROOT = path.join(process.cwd(), "test-data", "indexes-test");

describe("IndexManager", () => {
  let indexManager: IndexManager;

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });

    indexManager = new IndexManager(TEST_ROOT);
  });

  afterEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  describe("ensureIndex", () => {
    it("should build index from existing documents", async () => {
      // Create test documents
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open", priority: 1 },
        { type: "task", id: "002", status: "closed", priority: 2 },
        { type: "task", id: "003", status: "open", priority: 3 },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      // Build index and verify stats
      const stats = await indexManager.ensureIndex("task", "status");

      // Verify stats
      expect(stats.field).toBe("status");
      expect(stats.docsScanned).toBe(3);
      expect(stats.keys).toBe(2); // "open" and "closed"
      expect(stats.bytes).toBeGreaterThan(0);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);

      // Verify index file exists
      const indexPath = path.join(TEST_ROOT, "task", "_indexes", "status.json");
      const exists = await fs
        .access(indexPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      // Verify index content
      const content = await fs.readFile(indexPath, "utf-8");
      const index = JSON.parse(content);

      expect(index).toEqual({
        open: ["001", "003"],
        closed: ["002"],
      });
    });

    it("should handle nested field indexing", async () => {
      const typeDir = path.join(TEST_ROOT, "user");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "user", id: "001", address: { city: "NYC" } },
        { type: "user", id: "002", address: { city: "SF" } },
        { type: "user", id: "003", address: { city: "NYC" } },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("user", "address.city");

      const indexPath = path.join(TEST_ROOT, "user", "_indexes", "address.city.json");
      const content = await fs.readFile(indexPath, "utf-8");
      const index = JSON.parse(content);

      expect(index).toEqual({
        NYC: ["001", "003"],
        SF: ["002"],
      });
    });

    it("should handle multi-valued fields (arrays)", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", tags: ["urgent", "bug"] },
        { type: "task", id: "002", tags: ["feature", "urgent"] },
        { type: "task", id: "003", tags: ["bug"] },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "tags");

      const indexPath = path.join(TEST_ROOT, "task", "_indexes", "tags.json");
      const content = await fs.readFile(indexPath, "utf-8");
      const index = JSON.parse(content);

      expect(index).toEqual({
        urgent: ["001", "002"],
        bug: ["001", "003"],
        feature: ["002"],
      });
    });

    it("should deduplicate array values in index", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [{ type: "task", id: "001", tags: ["bug", "bug", "urgent"] }];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "tags");

      const indexPath = path.join(TEST_ROOT, "task", "_indexes", "tags.json");
      const content = await fs.readFile(indexPath, "utf-8");
      const index = JSON.parse(content);

      // Should only have one entry for "bug"
      expect(index.bug).toEqual(["001"]);
      expect(index.urgent).toEqual(["001"]);
    });

    it("should handle object values", async () => {
      const typeDir = path.join(TEST_ROOT, "config");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "config", id: "001", settings: { theme: "dark", size: 14 } },
        { type: "config", id: "002", settings: { theme: "light", size: 12 } },
        { type: "config", id: "003", settings: { theme: "dark", size: 14 } },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("config", "settings");

      const indexPath = path.join(TEST_ROOT, "config", "_indexes", "settings.json");
      const content = await fs.readFile(indexPath, "utf-8");
      const index = JSON.parse(content);

      // Objects should be prefixed with __obj__:
      const keys = Object.keys(index);
      expect(keys.every((k) => k.startsWith("__obj__:"))).toBe(true);

      // Should have two unique object values
      expect(keys).toHaveLength(2);

      // Query with object value
      const ids = await indexManager.queryWithIndex("config", "settings", {
        theme: "dark",
        size: 14,
      });
      expect(ids).toEqual(["001", "003"]);
    });

    it("should handle special value types", async () => {
      const typeDir = path.join(TEST_ROOT, "item");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "item", id: "001", count: 42, active: true, optional: null },
        { type: "item", id: "002", count: 100, active: false, optional: null },
        { type: "item", id: "003", count: 42, active: true },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      // Test number indexing
      await indexManager.ensureIndex("item", "count");
      let content = await fs.readFile(
        path.join(TEST_ROOT, "item", "_indexes", "count.json"),
        "utf-8"
      );
      let index = JSON.parse(content);
      expect(index).toEqual({
        __num__42: ["001", "003"],
        __num__100: ["002"],
      });

      // Test boolean indexing
      await indexManager.ensureIndex("item", "active");
      content = await fs.readFile(path.join(TEST_ROOT, "item", "_indexes", "active.json"), "utf-8");
      index = JSON.parse(content);
      expect(index).toEqual({
        __bool__true: ["001", "003"],
        __bool__false: ["002"],
      });

      // Test null indexing
      await indexManager.ensureIndex("item", "optional");
      content = await fs.readFile(
        path.join(TEST_ROOT, "item", "_indexes", "optional.json"),
        "utf-8"
      );
      index = JSON.parse(content);
      expect(index).toEqual({
        __null__: ["001", "002"],
      });
    });

    it("should escape strings starting with reserved prefixes", async () => {
      const typeDir = path.join(TEST_ROOT, "item");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "item", id: "001", label: "__num__test" },
        { type: "item", id: "002", label: "__bool__value" },
        { type: "item", id: "003", label: "normal" },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("item", "label");

      const content = await fs.readFile(
        path.join(TEST_ROOT, "item", "_indexes", "label.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      expect(index).toEqual({
        "__str__:__num__test": ["001"],
        "__str__:__bool__value": ["002"],
        normal: ["003"],
      });
    });

    it("should produce canonical formatted index files", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open" },
        { type: "task", id: "002", status: "closed" },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );

      // Should have sorted keys and trailing newline
      expect(content).toMatch(/^\{\n {2}"closed":/);
      expect(content).toMatch(/"open":/);
      expect(content).toMatch(/\n$/);

      // Rebuild should produce identical content
      await indexManager.ensureIndex("task", "status");
      const content2 = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );
      expect(content2).toBe(content);
    });
  });

  describe("updateIndex", () => {
    it("should skip update when index doesn't exist", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      // Call updateIndex without creating index first - should be a no-op
      await indexManager.updateIndex("task", "status", "001", undefined, "open");

      // Index file should not exist
      const indexPath = path.join(TEST_ROOT, "task", "_indexes", "status.json");
      const exists = await fs
        .access(indexPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("should update index on document change", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open" },
        { type: "task", id: "002", status: "closed" },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      // Update: change status from "open" to "closed"
      await indexManager.updateIndex("task", "status", "001", "open", "closed");

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      expect(index).toEqual({
        closed: ["001", "002"],
      });
    });

    it("should handle adding new values", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [{ type: "task", id: "001", status: "open" }];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      // Add new value
      await indexManager.updateIndex("task", "status", "002", undefined, "closed");

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      expect(index).toEqual({
        open: ["001"],
        closed: ["002"],
      });
    });

    it("should handle removing values", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open" },
        { type: "task", id: "002", status: "closed" },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      // Remove value
      await indexManager.updateIndex("task", "status", "001", "open", undefined);

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      expect(index).toEqual({
        closed: ["002"],
      });
    });

    it("should handle array value changes", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [{ type: "task", id: "001", tags: ["urgent", "bug"] }];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "tags");

      // Change array: remove "urgent", add "feature"
      await indexManager.updateIndex("task", "tags", "001", ["urgent", "bug"], ["bug", "feature"]);

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "tags.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      expect(index).toEqual({
        bug: ["001"],
        feature: ["001"],
      });
    });

    it("should maintain sorted IDs in buckets", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [{ type: "task", id: "001", status: "open" }];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      // Add IDs in non-sorted order
      await indexManager.updateIndex("task", "status", "003", undefined, "open");
      await indexManager.updateIndex("task", "status", "002", undefined, "open");

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      // Should be sorted
      expect(index.open).toEqual(["001", "002", "003"]);
    });
  });

  describe("queryWithIndex", () => {
    beforeEach(async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open", tags: ["urgent", "bug"] },
        { type: "task", id: "002", status: "closed", tags: ["feature"] },
        { type: "task", id: "003", status: "open", tags: ["bug"] },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");
      await indexManager.ensureIndex("task", "tags");
    });

    it("should return correct IDs for equality lookup", async () => {
      const ids = await indexManager.queryWithIndex("task", "status", "open");
      expect(ids).toEqual(["001", "003"]);
    });

    it("should return empty array for non-existent value", async () => {
      const ids = await indexManager.queryWithIndex("task", "status", "pending");
      expect(ids).toEqual([]);
    });

    it("should handle multi-valued field queries", async () => {
      const ids = await indexManager.queryWithIndex("task", "tags", "bug");
      expect(ids).toEqual(["001", "003"]);
    });

    it("should handle special value types", async () => {
      const typeDir = path.join(TEST_ROOT, "item");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "item", id: "001", count: 42 },
        { type: "item", id: "002", count: 100 },
        { type: "item", id: "003", count: 42 },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("item", "count");

      const ids = await indexManager.queryWithIndex("item", "count", 42);
      expect(ids).toEqual(["001", "003"]);
    });
  });

  describe("hasIndex", () => {
    it("should return true for existing index", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [{ type: "task", id: "001", status: "open" }];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      const exists = await indexManager.hasIndex("task", "status");
      expect(exists).toBe(true);
    });

    it("should return false for non-existent index", async () => {
      const exists = await indexManager.hasIndex("task", "priority");
      expect(exists).toBe(false);
    });
  });

  describe("rebuildIndexes", () => {
    it("should rebuild all existing indexes when fields not specified", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open", priority: 1 },
        { type: "task", id: "002", status: "closed", priority: 2 },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      // Create initial indexes
      await indexManager.ensureIndex("task", "status");
      await indexManager.ensureIndex("task", "priority");

      // Corrupt one index
      await fs.writeFile(path.join(TEST_ROOT, "task", "_indexes", "status.json"), "{ invalid json");

      // Rebuild should fix it
      await indexManager.rebuildIndexes("task");

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      expect(index).toEqual({
        open: ["001"],
        closed: ["002"],
      });
    });

    it("should rebuild specific fields when provided", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open", priority: 1 },
        { type: "task", id: "002", status: "closed", priority: 2 },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.rebuildIndexes("task", { fields: ["status"] });

      const hasStatus = await indexManager.hasIndex("task", "status");
      const hasPriority = await indexManager.hasIndex("task", "priority");

      expect(hasStatus).toBe(true);
      expect(hasPriority).toBe(false);
    });

    it("should return statistics when rebuilding", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open", priority: 1 },
        { type: "task", id: "002", status: "closed", priority: 2 },
        { type: "task", id: "003", status: "open", priority: 1 },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      const summary = await indexManager.rebuildIndexes("task", { fields: ["status"] });

      expect(summary.type).toBe("task");
      expect(summary.docsScanned).toBe(3);
      expect(summary.fields).toHaveLength(1);
      expect(summary.fields[0].field).toBe("status");
      expect(summary.fields[0].docsScanned).toBe(3);
      expect(summary.fields[0].keys).toBe(2); // "open" and "closed"
      expect(summary.fields[0].bytes).toBeGreaterThan(0);
      expect(summary.fields[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should delete existing indexes when force is true", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open" },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      // Create an index with stale data
      await indexManager.ensureIndex("task", "status");
      const indexPath = path.join(TEST_ROOT, "task", "_indexes", "status.json");
      const mtimeBefore = (await fs.stat(indexPath)).mtime;

      // Wait a bit to ensure mtime difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Force rebuild should delete and recreate
      await indexManager.rebuildIndexes("task", { fields: ["status"], force: true });

      const mtimeAfter = (await fs.stat(indexPath)).mtime;
      expect(mtimeAfter.getTime()).toBeGreaterThan(mtimeBefore.getTime());
    });

    it("should return empty summary when no indexes to rebuild", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const summary = await indexManager.rebuildIndexes("task");

      expect(summary.type).toBe("task");
      expect(summary.docsScanned).toBe(0);
      expect(summary.fields).toEqual([]);
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("removeIndex", () => {
    it("should remove index file", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [{ type: "task", id: "001", status: "open" }];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      let exists = await indexManager.hasIndex("task", "status");
      expect(exists).toBe(true);

      await indexManager.removeIndex("task", "status");

      exists = await indexManager.hasIndex("task", "status");
      expect(exists).toBe(false);
    });

    it("should be idempotent", async () => {
      await indexManager.removeIndex("task", "status");
      await indexManager.removeIndex("task", "status");
      // Should not throw
    });
  });

  describe("listIndexes", () => {
    it("should list all indexed fields for a type", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [
        { type: "task", id: "001", status: "open", priority: 1, tags: ["urgent"] },
      ];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");
      await indexManager.ensureIndex("task", "priority");
      await indexManager.ensureIndex("task", "tags");

      const fields = await indexManager.listIndexes("task");
      expect(fields.sort()).toEqual(["priority", "status", "tags"]);
    });

    it("should return empty array when no indexes exist", async () => {
      const fields = await indexManager.listIndexes("task");
      expect(fields).toEqual([]);
    });
  });

  describe("concurrency", () => {
    it("should handle concurrent updates without lost updates", async () => {
      const typeDir = path.join(TEST_ROOT, "task");
      await fs.mkdir(typeDir, { recursive: true });

      const docs: Document[] = [{ type: "task", id: "001", status: "open" }];

      for (const doc of docs) {
        await fs.writeFile(
          path.join(typeDir, `${doc.id}.json`),
          JSON.stringify(doc, null, 2) + "\n"
        );
      }

      await indexManager.ensureIndex("task", "status");

      // Concurrent updates
      const updates = [];
      for (let i = 2; i <= 50; i++) {
        updates.push(indexManager.updateIndex("task", "status", `00${i}`, undefined, "open"));
      }

      await Promise.all(updates);

      const content = await fs.readFile(
        path.join(TEST_ROOT, "task", "_indexes", "status.json"),
        "utf-8"
      );
      const index = JSON.parse(content);

      // Should have all 50 IDs
      expect(index.open).toHaveLength(50);
      expect(index.open).toContain("001");
      expect(index.open).toContain("0050");
    });
  });
});
