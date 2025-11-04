/**
 * Performance benchmarks for query execution
 * Run with: VITEST_PERF=1 pnpm --filter @jsonstore/sdk test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.js";
import type { Store } from "../src/types.js";

// Only run benchmarks if VITEST_PERF is set
const describeIf = process.env.VITEST_PERF ? describe : describe.skip;

describeIf("Query Performance Benchmarks", () => {
  let testDir: string;
  let store: Store;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-bench-"));
    store = openStore({ root: testDir });
  });

  afterEach(async () => {
    await store.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it("1000 docs, simple $eq filter - cold < 150ms", { timeout: 30000 }, async () => {
    // Seed 1000 documents
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: String(i) },
        {
          type: "task",
          id: String(i),
          status: i % 3 === 0 ? "open" : i % 3 === 1 ? "closed" : "ready",
          priority: Math.floor(Math.random() * 10) + 1,
          title: `Task ${i}`,
          description: `This is task number ${i}`,
        }
      );
    }

    // Clear cache to simulate cold start
    await store.close();
    store = openStore({ root: testDir });

    // Benchmark query
    const start = Date.now();
    const results = await store.query({
      type: "task",
      filter: { status: { $eq: "open" } },
    });
    const duration = Date.now() - start;

    console.log(`Simple $eq filter: ${results.length} results in ${duration}ms`);
    expect(duration).toBeLessThanOrEqual(150);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.status === "open")).toBe(true);
  });

  it("1000 docs, complex filter + sort - cold < 200ms", { timeout: 30000 }, async () => {
    // Seed 1000 documents
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: String(i) },
        {
          type: "task",
          id: String(i),
          status: i % 3 === 0 ? "open" : i % 3 === 1 ? "closed" : "ready",
          priority: Math.floor(Math.random() * 10) + 1,
          title: `Task ${i}`,
          description: `This is task number ${i}`,
        }
      );
    }

    // Clear cache to simulate cold start
    await store.close();
    store = openStore({ root: testDir });

    // Benchmark complex query
    const start = Date.now();
    const results = await store.query({
      type: "task",
      filter: {
        $and: [{ status: { $in: ["open", "ready"] } }, { priority: { $gte: 5 } }],
      },
      sort: { priority: -1, title: 1 },
      limit: 50,
    });
    const duration = Date.now() - start;

    console.log(`Complex filter + sort: ${results.length} results in ${duration}ms`);
    expect(duration).toBeLessThan(200);
    expect(results.length).toBeLessThanOrEqual(50);

    // Verify results are sorted correctly
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      if (prev.priority === curr.priority) {
        // Same priority - should be sorted by title
        expect((prev.title as string) <= (curr.title as string)).toBe(true);
      } else {
        // Different priority - should be descending
        expect((prev.priority as number) >= (curr.priority as number)).toBe(true);
      }
    }
  });

  it("1000 docs, ID-based fast path - cold < 50ms", { timeout: 30000 }, async () => {
    // Seed 1000 documents
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: String(i) },
        {
          type: "task",
          id: String(i),
          status: "open",
          priority: i,
        }
      );
    }

    // Clear cache to simulate cold start
    await store.close();
    store = openStore({ root: testDir });

    // Benchmark fast path query
    const start = Date.now();
    const results = await store.query({
      type: "task",
      filter: { id: { $in: ["100", "200", "300", "400", "500"] } },
    });
    const duration = Date.now() - start;

    console.log(`Fast path ID filter: ${results.length} results in ${duration}ms`);
    expect(duration).toBeLessThan(50);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.id).sort()).toEqual(["100", "200", "300", "400", "500"]);
  });

  it(
    "1000 docs, streaming query with early termination - cold < 100ms",
    { timeout: 30000 },
    async () => {
      // Seed 1000 documents
      for (let i = 1; i <= 1000; i++) {
        await store.put(
          { type: "task", id: String(i) },
          {
            type: "task",
            id: String(i),
            status: i % 2 === 0 ? "open" : "closed",
            priority: i,
          }
        );
      }

      // Clear cache to simulate cold start
      await store.close();
      store = openStore({ root: testDir });

      // Benchmark streaming query (should terminate early)
      const start = Date.now();
      const results = await store.query({
        type: "task",
        filter: { status: { $eq: "open" } },
        limit: 10,
      });
      const duration = Date.now() - start;

      console.log(`Streaming with early termination: ${results.length} results in ${duration}ms`);
      expect(duration).toBeLessThan(100);
      expect(results).toHaveLength(10);
      expect(results.every((r) => r.status === "open")).toBe(true);
    }
  );

  it("Multi-type scan performance - 500 docs across 5 types", { timeout: 30000 }, async () => {
    // Seed 500 documents across 5 types
    const types = ["task", "note", "user", "project", "comment"];
    for (let i = 1; i <= 500; i++) {
      const type = types[i % 5];
      await store.put(
        { type, id: String(i) },
        {
          type,
          id: String(i),
          status: i % 2 === 0 ? "active" : "inactive",
          value: i,
        }
      );
    }

    // Clear cache to simulate cold start
    await store.close();
    store = openStore({ root: testDir });

    // Benchmark multi-type query
    const start = Date.now();
    const results = await store.query({
      filter: { status: { $eq: "active" } },
      sort: { value: 1 },
      limit: 50,
    });
    const duration = Date.now() - start;

    console.log(`Multi-type scan: ${results.length} results in ${duration}ms`);
    expect(duration).toBeLessThan(250);
    expect(results).toHaveLength(50);
    expect(results.every((r) => r.status === "active")).toBe(true);

    // Verify multiple types are present
    const resultTypes = new Set(results.map((r) => r.type));
    expect(resultTypes.size).toBeGreaterThan(1);
  });

  it("Projection performance - 1000 docs with large fields", { timeout: 30000 }, async () => {
    // Seed 1000 documents with large description fields
    const largeText = "x".repeat(1000);
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: String(i) },
        {
          type: "task",
          id: String(i),
          status: "open",
          priority: i,
          title: `Task ${i}`,
          description: largeText,
          metadata: { large: largeText, nested: { deep: largeText } },
        }
      );
    }

    // Clear cache to simulate cold start
    await store.close();
    store = openStore({ root: testDir });

    // Benchmark query with projection (should skip large fields)
    const start = Date.now();
    const results = await store.query({
      type: "task",
      filter: { priority: { $gte: 500 } },
      projection: { type: 1, id: 1, title: 1, priority: 1 },
      limit: 100,
    });
    const duration = Date.now() - start;

    console.log(`Projection (skip large fields): ${results.length} results in ${duration}ms`);
    expect(duration).toBeLessThan(150);
    expect(results).toHaveLength(100);
    expect(results.every((r) => !r.description && !r.metadata)).toBe(true);
  });

  it("Pagination performance - skip + limit on 1000 docs", { timeout: 30000 }, async () => {
    // Seed 1000 documents
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: String(i) },
        {
          type: "task",
          id: String(i),
          value: i,
        }
      );
    }

    // Clear cache to simulate cold start
    await store.close();
    store = openStore({ root: testDir });

    // Benchmark paginated query
    const start = Date.now();
    const results = await store.query({
      type: "task",
      filter: {},
      sort: { value: 1 },
      skip: 800,
      limit: 50,
    });
    const duration = Date.now() - start;

    console.log(`Pagination (skip 800, limit 50): ${results.length} results in ${duration}ms`);
    expect(duration).toBeLessThan(200);
    expect(results).toHaveLength(50);
    expect(results[0].value).toBe(801);
    expect(results[49].value).toBe(850);
  });
});
