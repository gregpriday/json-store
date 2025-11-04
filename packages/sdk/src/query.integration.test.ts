/**
 * Integration tests for query execution engine
 * Tests end-to-end query functionality through Store.query()
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.js";
import type { Store } from "./types.js";

describe("Query Integration Tests", () => {
  let testDir: string;
  let store: Store;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-query-test-"));
    store = openStore({ root: testDir });
  });

  afterEach(async () => {
    await store.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Filter Operators", () => {
    beforeEach(async () => {
      // Seed test data
      await store.put(
        { type: "task", id: "1" },
        { type: "task", id: "1", status: "open", priority: 5, title: "Task 1" }
      );
      await store.put(
        { type: "task", id: "2" },
        { type: "task", id: "2", status: "closed", priority: 3, title: "Task 2" }
      );
      await store.put(
        { type: "task", id: "3" },
        { type: "task", id: "3", status: "open", priority: 8, title: "Task 3" }
      );
      await store.put(
        { type: "task", id: "4" },
        { type: "task", id: "4", status: "ready", priority: 5, title: "Task 4" }
      );
    });

    it("$eq matches exact value", async () => {
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "open")).toBe(true);
    });

    it("literal equality (no operator)", async () => {
      const results = await store.query({
        type: "task",
        filter: { status: "open" },
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "open")).toBe(true);
    });

    it("$ne excludes value", async () => {
      const results = await store.query({
        type: "task",
        filter: { status: { $ne: "open" } },
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status !== "open")).toBe(true);
    });

    it("$in matches array of values", async () => {
      const results = await store.query({
        type: "task",
        filter: { status: { $in: ["open", "ready"] } },
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "open" || r.status === "ready")).toBe(true);
    });

    it("$nin excludes array of values", async () => {
      const results = await store.query({
        type: "task",
        filter: { status: { $nin: ["open", "ready"] } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("closed");
    });

    it("$gt numeric comparison", async () => {
      const results = await store.query({
        type: "task",
        filter: { priority: { $gt: 5 } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].priority).toBe(8);
    });

    it("$gte numeric comparison", async () => {
      const results = await store.query({
        type: "task",
        filter: { priority: { $gte: 5 } },
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => (r.priority as number) >= 5)).toBe(true);
    });

    it("$lt numeric comparison", async () => {
      const results = await store.query({
        type: "task",
        filter: { priority: { $lt: 5 } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].priority).toBe(3);
    });

    it("$lte numeric comparison", async () => {
      const results = await store.query({
        type: "task",
        filter: { priority: { $lte: 5 } },
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => (r.priority as number) <= 5)).toBe(true);
    });

    it("$exists checks field presence", async () => {
      await store.put({ type: "task", id: "5" }, { type: "task", id: "5", status: "open" });

      const withPriority = await store.query({
        type: "task",
        filter: { priority: { $exists: true } },
      });

      expect(withPriority).toHaveLength(4);

      const withoutPriority = await store.query({
        type: "task",
        filter: { priority: { $exists: false } },
      });

      expect(withoutPriority).toHaveLength(1);
      expect(withoutPriority[0].id).toBe("5");
    });

    it("$type validates field type", async () => {
      await store.put(
        { type: "task", id: "5" },
        { type: "task", id: "5", tags: ["urgent", "bug"] }
      );

      const withArray = await store.query({
        type: "task",
        filter: { tags: { $type: "array" } },
      });

      expect(withArray).toHaveLength(1);
      expect(withArray[0].id).toBe("5");

      const withString = await store.query({
        type: "task",
        filter: { title: { $type: "string" } },
      });

      expect(withString).toHaveLength(4);
    });
  });

  describe("Logical Operators", () => {
    beforeEach(async () => {
      await store.put(
        { type: "task", id: "1" },
        { type: "task", id: "1", status: "open", priority: 5 }
      );
      await store.put(
        { type: "task", id: "2" },
        { type: "task", id: "2", status: "closed", priority: 3 }
      );
      await store.put(
        { type: "task", id: "3" },
        { type: "task", id: "3", status: "open", priority: 8 }
      );
    });

    it("$and logical AND", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $and: [{ status: { $eq: "open" } }, { priority: { $gte: 5 } }],
        },
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "open" && (r.priority as number) >= 5)).toBe(true);
    });

    it("$or logical OR", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $or: [{ status: { $eq: "closed" } }, { priority: { $gte: 8 } }],
        },
      });

      expect(results).toHaveLength(2);
      expect(results.some((r) => r.status === "closed")).toBe(true);
      expect(results.some((r) => r.priority === 8)).toBe(true);
    });

    it("$not logical NOT", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $not: { status: { $eq: "open" } },
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("closed");
    });

    it("combines logical operator with field predicates", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          status: "open",
          $or: [{ priority: { $gte: 8 } }, { priority: { $lte: 5 } }],
        },
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "open")).toBe(true);
      expect(results.some((r) => r.priority === 8)).toBe(true);
      expect(results.some((r) => r.priority === 5)).toBe(true);
    });

    it("nested logical operators", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $or: [
            { $and: [{ status: { $eq: "open" } }, { priority: { $gte: 8 } }] },
            { status: { $eq: "closed" } },
          ],
        },
      });

      expect(results).toHaveLength(2);
      expect(results.some((r) => r.status === "open" && r.priority === 8)).toBe(true);
      expect(results.some((r) => r.status === "closed")).toBe(true);
    });
  });

  describe("Nested Field Access", () => {
    beforeEach(async () => {
      await store.put(
        { type: "user", id: "1" },
        { type: "user", id: "1", name: "Alice", address: { city: "NYC", zip: "10001" } }
      );
      await store.put(
        { type: "user", id: "2" },
        { type: "user", id: "2", name: "Bob", address: { city: "LA", zip: "90001" } }
      );
    });

    it("queries nested fields with dot notation", async () => {
      const results = await store.query({
        type: "user",
        filter: { "address.city": { $eq: "NYC" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Alice");
    });
  });

  describe("Sort", () => {
    beforeEach(async () => {
      await store.put(
        { type: "task", id: "1" },
        { type: "task", id: "1", priority: 5, title: "B Task" }
      );
      await store.put(
        { type: "task", id: "2" },
        { type: "task", id: "2", priority: 3, title: "C Task" }
      );
      await store.put(
        { type: "task", id: "3" },
        { type: "task", id: "3", priority: 8, title: "A Task" }
      );
      await store.put(
        { type: "task", id: "4" },
        { type: "task", id: "4", priority: 5, title: "A Task" }
      );
    });

    it("sorts ascending by single field", async () => {
      const results = await store.query({
        type: "task",
        filter: {},
        sort: { priority: 1 },
      });

      expect(results).toHaveLength(4);
      expect(results[0].priority).toBe(3);
      expect(results[3].priority).toBe(8);
    });

    it("sorts descending by single field", async () => {
      const results = await store.query({
        type: "task",
        filter: {},
        sort: { priority: -1 },
      });

      expect(results).toHaveLength(4);
      expect(results[0].priority).toBe(8);
      expect(results[3].priority).toBe(3);
    });

    it("multi-field sort with priority order", async () => {
      const results = await store.query({
        type: "task",
        filter: {},
        sort: { priority: -1, title: 1 },
      });

      expect(results).toHaveLength(4);
      expect(results[0].priority).toBe(8);
      expect(results[1].priority).toBe(5);
      expect(results[1].title).toBe("A Task");
      expect(results[2].priority).toBe(5);
      expect(results[2].title).toBe("B Task");
    });

    it("sort with mixed types (stable comparison)", async () => {
      await store.put({ type: "mixed", id: "1" }, { type: "mixed", id: "1", value: 10 });
      await store.put({ type: "mixed", id: "2" }, { type: "mixed", id: "2", value: "hello" });
      await store.put({ type: "mixed", id: "3" }, { type: "mixed", id: "3", value: true });
      await store.put({ type: "mixed", id: "4" }, { type: "mixed", id: "4" }); // undefined value

      const results = await store.query({
        type: "mixed",
        filter: {},
        sort: { value: 1 },
      });

      expect(results).toHaveLength(4);
      // undefined < boolean < number < string
      expect(results[0].value).toBeUndefined();
      expect(results[1].value).toBe(true);
      expect(results[2].value).toBe(10);
      expect(results[3].value).toBe("hello");
    });
  });

  describe("Projection", () => {
    beforeEach(async () => {
      await store.put(
        { type: "task", id: "1" },
        {
          type: "task",
          id: "1",
          status: "open",
          priority: 5,
          title: "Task 1",
          description: "Long text",
        }
      );
    });

    it("includes specific fields", async () => {
      const results = await store.query({
        type: "task",
        filter: {},
        projection: { type: 1, id: 1, title: 1 },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty("type");
      expect(results[0]).toHaveProperty("id");
      expect(results[0]).toHaveProperty("title");
      expect(results[0]).not.toHaveProperty("status");
      expect(results[0]).not.toHaveProperty("priority");
      expect(results[0]).not.toHaveProperty("description");
    });

    it("excludes specific fields", async () => {
      const results = await store.query({
        type: "task",
        filter: {},
        projection: { description: 0 },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty("type");
      expect(results[0]).toHaveProperty("id");
      expect(results[0]).toHaveProperty("title");
      expect(results[0]).not.toHaveProperty("description");
    });

    it("projects nested fields", async () => {
      await store.put(
        { type: "user", id: "1" },
        { type: "user", id: "1", name: "Alice", address: { city: "NYC", zip: "10001" } }
      );

      const results = await store.query({
        type: "user",
        filter: {},
        projection: { type: 1, id: 1, "address.city": 1 },
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty("type");
      expect(results[0]).toHaveProperty("id");
      expect(results[0]).toHaveProperty("address.city");
      expect(results[0]).not.toHaveProperty("name");
    });
  });

  describe("Pagination", () => {
    beforeEach(async () => {
      for (let i = 1; i <= 10; i++) {
        await store.put({ type: "item", id: String(i) }, { type: "item", id: String(i), value: i });
      }
    });

    it("limits results", async () => {
      const results = await store.query({
        type: "item",
        filter: {},
        limit: 5,
      });

      expect(results).toHaveLength(5);
    });

    it("skips results", async () => {
      const results = await store.query({
        type: "item",
        filter: {},
        sort: { value: 1 },
        skip: 3,
      });

      expect(results).toHaveLength(7);
      expect(results[0].value).toBe(4);
    });

    it("skips results without sort (streaming path)", async () => {
      const results = await store.query({
        type: "item",
        filter: {},
        skip: 5,
        limit: 3,
      });

      expect(results).toHaveLength(3);
      // Without sort, order may vary, but should skip 5 and return 3
      expect(results.every((r) => r.value !== undefined)).toBe(true);
    });

    it("combines limit and skip", async () => {
      const results = await store.query({
        type: "item",
        filter: {},
        sort: { value: 1 },
        skip: 3,
        limit: 4,
      });

      expect(results).toHaveLength(4);
      expect(results[0].value).toBe(4);
      expect(results[3].value).toBe(7);
    });
  });

  describe("Multi-type Queries", () => {
    beforeEach(async () => {
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1", status: "open" });
      await store.put({ type: "task", id: "2" }, { type: "task", id: "2", status: "closed" });
      await store.put({ type: "note", id: "1" }, { type: "note", id: "1", status: "draft" });
      await store.put({ type: "note", id: "2" }, { type: "note", id: "2", status: "published" });
    });

    it("queries across multiple types when type not specified", async () => {
      const results = await store.query({
        filter: {},
      });

      expect(results).toHaveLength(4);
      const types = new Set(results.map((r) => r.type));
      expect(types.size).toBe(2);
      expect(types.has("task")).toBe(true);
      expect(types.has("note")).toBe(true);
    });

    it("filters across multiple types", async () => {
      const results = await store.query({
        filter: { status: { $in: ["open", "draft"] } },
      });

      expect(results).toHaveLength(2);
      expect(results.some((r) => r.type === "task" && r.status === "open")).toBe(true);
      expect(results.some((r) => r.type === "note" && r.status === "draft")).toBe(true);
    });
  });

  describe("Complex Queries", () => {
    beforeEach(async () => {
      for (let i = 1; i <= 20; i++) {
        await store.put(
          { type: "task", id: String(i) },
          {
            type: "task",
            id: String(i),
            status: i % 2 === 0 ? "open" : "closed",
            priority: Math.floor(Math.random() * 10) + 1,
            title: `Task ${i}`,
          }
        );
      }
    });

    it("complex query with filter + sort + projection + limit", async () => {
      const results = await store.query({
        type: "task",
        filter: {
          $and: [{ status: { $eq: "open" } }, { priority: { $gte: 5 } }],
        },
        sort: { priority: -1, title: 1 },
        projection: { type: 1, id: 1, title: 1, priority: 1 },
        limit: 5,
      });

      expect(results.length).toBeLessThanOrEqual(5);
      expect(results.every((r) => r.status === undefined)).toBe(true); // projected out
      expect(results.every((r) => r.title !== undefined)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("empty filter matches all documents", async () => {
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1", status: "open" });
      await store.put({ type: "task", id: "2" }, { type: "task", id: "2", status: "closed" });

      const results = await store.query({
        type: "task",
        filter: {},
      });

      expect(results).toHaveLength(2);
    });

    it("query on missing field returns correctly", async () => {
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1", status: "open" });
      await store.put({ type: "task", id: "2" }, { type: "task", id: "2", priority: 5 });

      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("query with null values", async () => {
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1", status: null });
      await store.put({ type: "task", id: "2" }, { type: "task", id: "2", status: "open" });

      const withNull = await store.query({
        type: "task",
        filter: { status: { $eq: null } },
      });

      expect(withNull).toHaveLength(1);
      expect(withNull[0].id).toBe("1");
    });

    it("query with undefined values", async () => {
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1" });
      await store.put({ type: "task", id: "2" }, { type: "task", id: "2", status: "open" });

      const withoutStatus = await store.query({
        type: "task",
        filter: { status: { $exists: false } },
      });

      expect(withoutStatus).toHaveLength(1);
      expect(withoutStatus[0].id).toBe("1");
    });

    it("query matching no results", async () => {
      await store.put({ type: "task", id: "1" }, { type: "task", id: "1", status: "open" });

      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "nonexistent" } },
      });

      expect(results).toHaveLength(0);
    });

    it("array field queries", async () => {
      await store.put(
        { type: "task", id: "1" },
        { type: "task", id: "1", tags: ["urgent", "bug"] }
      );
      await store.put({ type: "task", id: "2" }, { type: "task", id: "2", tags: ["feature"] });

      const results = await store.query({
        type: "task",
        filter: { tags: { $type: "array" } },
      });

      expect(results).toHaveLength(2);
    });
  });

  describe("Validation", () => {
    it("throws error when filter is missing", async () => {
      await expect(
        store.query({
          type: "task",
          filter: undefined as any,
        })
      ).rejects.toThrow("filter");
    });

    it("throws error when skip is negative", async () => {
      await expect(
        store.query({
          type: "task",
          filter: {},
          skip: -1,
        })
      ).rejects.toThrow("skip");
    });

    it("throws error when limit is zero or negative", async () => {
      await expect(
        store.query({
          type: "task",
          filter: {},
          limit: 0,
        })
      ).rejects.toThrow("limit");

      await expect(
        store.query({
          type: "task",
          filter: {},
          limit: -5,
        })
      ).rejects.toThrow("limit");
    });
  });

  describe("Fast Path Optimization", () => {
    beforeEach(async () => {
      for (let i = 1; i <= 10; i++) {
        await store.put({ type: "task", id: String(i) }, { type: "task", id: String(i), value: i });
      }
    });

    it("uses fast path for $eq id filter", async () => {
      const results = await store.query({
        type: "task",
        filter: { id: { $eq: "5" } },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("5");
    });

    it("uses fast path for $in id filter", async () => {
      const results = await store.query({
        type: "task",
        filter: { id: { $in: ["3", "5", "7"] } },
      });

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.id).sort()).toEqual(["3", "5", "7"]);
    });

    it("fast path respects pagination", async () => {
      const results = await store.query({
        type: "task",
        filter: { id: { $in: ["1", "2", "3", "4", "5"] } },
        skip: 1,
        limit: 2,
      });

      expect(results).toHaveLength(2);
      // Verify correct IDs are returned (sorted by ID)
      expect(results.map((r) => r.id)).toEqual(["2", "3"]);
    });
  });
});
