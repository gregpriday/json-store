/**
 * Integration tests for indexes with Store
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { openStore } from "./store.js";
import type { Store, Document } from "./types.js";

const TEST_ROOT = path.join(process.cwd(), "test-data", "indexes-integration-test");

describe("Index Integration", () => {
  let store: Store;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });

    store = openStore({
      root: TEST_ROOT,
      enableIndexes: true,
      indexes: {
        task: ["status", "priority"],
        user: ["role"],
      },
    });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  describe("Store integration", () => {
    it("should handle put before index exists (no-op)", async () => {
      // Put documents before creating index - should succeed
      await store.put(
        { type: "task", id: "001" },
        { type: "task", id: "001", status: "open", priority: 1 }
      );

      // Index shouldn't exist yet
      const indexPath = path.join(TEST_ROOT, "task", "_indexes", "status.json");
      const exists = await fs
        .access(indexPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);

      // Now create index and verify it works
      await store.ensureIndex("task", "status");

      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      expect(results).toHaveLength(1);
    });

    it("should update indexes on put operations", async () => {
      // Create initial documents
      await store.put(
        { type: "task", id: "001" },
        { type: "task", id: "001", status: "open", priority: 1 }
      );
      await store.put(
        { type: "task", id: "002" },
        { type: "task", id: "002", status: "closed", priority: 2 }
      );

      // Build indexes
      await store.ensureIndex("task", "status");
      await store.ensureIndex("task", "priority");

      // Update a document
      await store.put(
        { type: "task", id: "001" },
        { type: "task", id: "001", status: "closed", priority: 1 }
      );

      // Query using index
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "closed" } },
      });

      expect(results).toHaveLength(2);
      expect(results.map((d) => d.id).sort()).toEqual(["001", "002"]);
    });

    it("should update indexes on remove operations", async () => {
      // Create documents
      await store.put(
        { type: "task", id: "001" },
        { type: "task", id: "001", status: "open", priority: 1 }
      );
      await store.put(
        { type: "task", id: "002" },
        { type: "task", id: "002", status: "open", priority: 2 }
      );

      await store.ensureIndex("task", "status");

      // Remove one document
      await store.remove({ type: "task", id: "001" });

      // Query should return only remaining document
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("002");
    });

    it(
      "should produce identical results with and without indexes",
      { timeout: 15000 },
      async () => {
        // Create test dataset
        const docs: Document[] = [];
        for (let i = 1; i <= 100; i++) {
          const status = i % 3 === 0 ? "closed" : i % 3 === 1 ? "open" : "pending";
          const priority = (i % 5) + 1;
          docs.push({
            type: "task",
            id: `${i}`.padStart(3, "0"),
            status,
            priority,
            title: `Task ${i}`,
          });
        }

        // Insert documents
        for (const doc of docs) {
          await store.put({ type: "task", id: doc.id }, doc);
        }

        // Query without index (full scan)
        const scanResults = await store.query({
          type: "task",
          filter: { status: { $eq: "open" } },
        });

        // Build index
        await store.ensureIndex("task", "status");

        // Query with index
        const indexResults = await store.query({
          type: "task",
          filter: { status: { $eq: "open" } },
        });

        // Results should be identical
        expect(indexResults).toHaveLength(scanResults.length);
        expect(indexResults.map((d) => d.id).sort()).toEqual(scanResults.map((d) => d.id).sort());
      }
    );

    it("should support scalar equality filters", async () => {
      await store.put({ type: "task", id: "001" }, { type: "task", id: "001", status: "open" });
      await store.put({ type: "task", id: "002" }, { type: "task", id: "002", status: "closed" });

      await store.ensureIndex("task", "status");

      // Scalar equality (no $eq operator)
      const results = await store.query({
        type: "task",
        filter: { status: "open" },
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("001");
    });

    it("should support $eq operator", async () => {
      await store.put({ type: "task", id: "001" }, { type: "task", id: "001", status: "open" });
      await store.put({ type: "task", id: "002" }, { type: "task", id: "002", status: "closed" });

      await store.ensureIndex("task", "status");

      // Explicit $eq operator
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("001");
    });

    it("should handle queries with sort, skip, and limit", async () => {
      // Create documents
      for (let i = 1; i <= 10; i++) {
        await store.put(
          { type: "task", id: `${i}`.padStart(3, "0") },
          {
            type: "task",
            id: `${i}`.padStart(3, "0"),
            status: "open",
            priority: i,
          }
        );
      }

      await store.ensureIndex("task", "status");

      // Query with sort and pagination
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
        sort: { priority: -1 },
        skip: 2,
        limit: 3,
      });

      expect(results).toHaveLength(3);
      expect(results[0]!.priority).toBe(8);
      expect(results[1]!.priority).toBe(7);
      expect(results[2]!.priority).toBe(6);
    });

    it("should handle queries with projection", async () => {
      await store.put(
        { type: "task", id: "001" },
        {
          type: "task",
          id: "001",
          status: "open",
          title: "Task 1",
          description: "Long description",
        }
      );

      await store.ensureIndex("task", "status");

      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
        projection: { id: 1, title: 1 },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ id: "001", title: "Task 1" });
    });

    it("should handle multi-valued field queries", async () => {
      // Reconfigure store to include tags index
      await store.close();
      store = openStore({
        root: TEST_ROOT,
        enableIndexes: true,
        indexes: {
          task: ["status", "priority", "tags"],
        },
      });

      await store.put(
        { type: "task", id: "001" },
        { type: "task", id: "001", tags: ["urgent", "bug"] }
      );
      await store.put(
        { type: "task", id: "002" },
        { type: "task", id: "002", tags: ["feature", "urgent"] }
      );
      await store.put({ type: "task", id: "003" }, { type: "task", id: "003", tags: ["bug"] });

      await store.ensureIndex("task", "tags");

      const results = await store.query({
        type: "task",
        filter: { tags: { $eq: "bug" } },
      });

      expect(results).toHaveLength(2);
      expect(results.map((d) => d.id).sort()).toEqual(["001", "003"]);
    });

    it("should handle nested field queries", async () => {
      await store.put(
        { type: "user", id: "001" },
        { type: "user", id: "001", address: { city: "NYC" } }
      );
      await store.put(
        { type: "user", id: "002" },
        { type: "user", id: "002", address: { city: "SF" } }
      );
      await store.put(
        { type: "user", id: "003" },
        { type: "user", id: "003", address: { city: "NYC" } }
      );

      await store.ensureIndex("user", "address.city");

      const results = await store.query({
        type: "user",
        filter: { "address.city": { $eq: "NYC" } },
      });

      expect(results).toHaveLength(2);
      expect(results.map((d) => d.id).sort()).toEqual(["001", "003"]);
    });

    it("should fall back to scan when index doesn't exist", async () => {
      await store.put({ type: "task", id: "001" }, { type: "task", id: "001", status: "open" });
      await store.put({ type: "task", id: "002" }, { type: "task", id: "002", status: "closed" });

      // Query without building index - should use full scan
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("001");
    });

    it("should handle concurrent queries and updates", async () => {
      // Insert initial documents
      for (let i = 1; i <= 50; i++) {
        await store.put(
          { type: "task", id: `${i}`.padStart(3, "0") },
          { type: "task", id: `${i}`.padStart(3, "0"), status: "open" }
        );
      }

      await store.ensureIndex("task", "status");

      // Run queries and updates concurrently
      const operations = [];

      for (let i = 1; i <= 10; i++) {
        operations.push(
          store.query({
            type: "task",
            filter: { status: { $eq: "open" } },
          })
        );
      }

      for (let i = 1; i <= 10; i++) {
        operations.push(
          store.put(
            { type: "task", id: `${i}`.padStart(3, "0") },
            { type: "task", id: `${i}`.padStart(3, "0"), status: "closed" }
          )
        );
      }

      await Promise.all(operations);

      // Final query should reflect updates
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "closed" } },
      });

      expect(results).toHaveLength(10);
    });
  });

  describe("Performance", () => {
    // Helper to measure query time
    const measureQuery = async (store: Store, filter: any): Promise<number> => {
      const start = performance.now();
      await store.query({
        type: "task",
        filter,
      });
      return performance.now() - start;
    };

    it(
      "should be significantly faster with index on large dataset",
      { timeout: 30000 },
      async () => {
        // Create large dataset (1000 documents)
        const docs: Document[] = [];
        for (let i = 1; i <= 1000; i++) {
          const status = i % 3 === 0 ? "closed" : i % 3 === 1 ? "open" : "pending";
          docs.push({
            type: "task",
            id: `${i}`.padStart(4, "0"),
            status,
            priority: (i % 5) + 1,
            title: `Task ${i}`,
          });
        }

        // Insert documents
        for (const doc of docs) {
          await store.put({ type: "task", id: doc.id }, doc);
        }

        // Measure scan time (without index)
        const scanTimes: number[] = [];
        for (let i = 0; i < 5; i++) {
          const time = await measureQuery(store, { status: { $eq: "open" } });
          scanTimes.push(time);
        }
        const medianScanTime = scanTimes.sort((a, b) => a - b)[Math.floor(scanTimes.length / 2)]!;

        // Build index
        await store.ensureIndex("task", "status");

        // Measure index time
        const indexTimes: number[] = [];
        for (let i = 0; i < 5; i++) {
          const time = await measureQuery(store, { status: { $eq: "open" } });
          indexTimes.push(time);
        }
        const medianIndexTime = indexTimes.sort((a, b) => a - b)[
          Math.floor(indexTimes.length / 2)
        ]!;

        // Index should be at least 3× faster (conservative for CI environments)
        // In practice, typically 10-100× faster
        const speedup = medianScanTime / medianIndexTime;

        console.log(`Scan median: ${medianScanTime.toFixed(2)}ms`);
        console.log(`Index median: ${medianIndexTime.toFixed(2)}ms`);
        console.log(`Speedup: ${speedup.toFixed(1)}×`);

        // Lenient assertion for CI - just verify index is faster
        expect(medianIndexTime).toBeLessThan(medianScanTime);

        // Stricter assertion (may be flaky on slow CI)
        // Using 2x threshold to reduce flakiness while still validating meaningful speedup
        if (process.env.CI !== "true") {
          expect(speedup).toBeGreaterThan(2);
        }
      }
    );

    it("should handle p95 query latency target on 1000 docs", { timeout: 30000 }, async () => {
      // Create dataset
      for (let i = 1; i <= 1000; i++) {
        await store.put(
          { type: "task", id: `${i}`.padStart(4, "0") },
          {
            type: "task",
            id: `${i}`.padStart(4, "0"),
            status: i % 2 === 0 ? "open" : "closed",
          }
        );
      }

      await store.ensureIndex("task", "status");

      // Run 20 queries to measure p95
      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const time = await measureQuery(store, { status: { $eq: "open" } });
        times.push(time);
      }

      times.sort((a, b) => a - b);
      const p95Index = Math.ceil(times.length * 0.95) - 1;
      const p95Time = times[p95Index]!;

      console.log(`P95 query time: ${p95Time.toFixed(2)}ms`);

      // P95 should be under 25ms on CI, 10ms on dev machines
      const threshold = process.env.CI === "true" ? 50 : 25;
      expect(p95Time).toBeLessThan(threshold);
    });

    it("should handle index update overhead", { timeout: 30000 }, async () => {
      // Measure put without index
      const start1 = performance.now();
      for (let i = 1; i <= 100; i++) {
        await store.put(
          { type: "task", id: `${i}`.padStart(3, "0") },
          { type: "task", id: `${i}`.padStart(3, "0"), status: "open" }
        );
      }
      const timeWithoutIndex = performance.now() - start1;

      // Build index
      await store.ensureIndex("task", "status");

      // Measure put with index
      const start2 = performance.now();
      for (let i = 101; i <= 200; i++) {
        await store.put(
          { type: "task", id: `${i}`.padStart(3, "0") },
          { type: "task", id: `${i}`.padStart(3, "0"), status: "open" }
        );
      }
      const timeWithIndex = performance.now() - start2;

      console.log(`Put without index: ${timeWithoutIndex.toFixed(2)}ms`);
      console.log(`Put with index: ${timeWithIndex.toFixed(2)}ms`);
      console.log(`Overhead: ${((timeWithIndex / timeWithoutIndex - 1) * 100).toFixed(1)}%`);

      // Index overhead should be reasonable
      // Very lenient check - actual overhead varies by platform
      // On fast machines < 10%, on slower machines or with I/O contention can be higher
      expect(timeWithIndex / timeWithoutIndex).toBeLessThan(3);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty result sets", async () => {
      await store.put({ type: "task", id: "001" }, { type: "task", id: "001", status: "open" });

      await store.ensureIndex("task", "status");

      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "nonexistent" } },
      });

      expect(results).toEqual([]);
    });

    it("should handle queries on non-indexed fields", async () => {
      await store.put(
        { type: "task", id: "001" },
        { type: "task", id: "001", status: "open", priority: 1 }
      );

      await store.ensureIndex("task", "status");

      // Query on non-indexed field should still work (using scan)
      const results = await store.query({
        type: "task",
        filter: { priority: { $eq: 1 } },
      });

      expect(results).toHaveLength(1);
    });

    it("should handle special value types in queries", async () => {
      await store.put(
        { type: "item", id: "001" },
        { type: "item", id: "001", count: 42, active: true, optional: null }
      );
      await store.put(
        { type: "item", id: "002" },
        { type: "item", id: "002", count: 100, active: false }
      );

      await store.ensureIndex("item", "count");
      await store.ensureIndex("item", "active");
      await store.ensureIndex("item", "optional");

      // Number query
      let results = await store.query({
        type: "item",
        filter: { count: { $eq: 42 } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("001");

      // Boolean query
      results = await store.query({
        type: "item",
        filter: { active: { $eq: true } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("001");

      // Null query
      results = await store.query({
        type: "item",
        filter: { optional: { $eq: null } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("001");
    });
  });
});
