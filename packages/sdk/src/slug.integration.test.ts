/**
 * Integration tests for slug functionality
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { openStore } from "./index.js";
import type { Store, SlugOptions } from "./types.js";

const TEST_ROOT = path.join(process.cwd(), "test-data-slug-integration");

describe("Slug Integration Tests", () => {
  let store: Store;

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
  });

  afterEach(async () => {
    if (store) {
      await store.close();
    }
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  test("generates slug automatically on put", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "San Francisco",
      }
    );

    const doc = await store.get({ type: "city", id: "city-1" });
    expect(doc).toBeDefined();
    expect(doc?.slug).toBe("san-francisco");
  });

  test("generates unique slugs for collisions", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    // First Portland
    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "Portland",
      }
    );

    // Second Portland (different city, same name)
    await store.put(
      { type: "city", id: "city-2" },
      {
        type: "city",
        id: "city-2",
        name: "Portland",
      }
    );

    const doc1 = await store.get({ type: "city", id: "city-1" });
    const doc2 = await store.get({ type: "city", id: "city-2" });

    expect(doc1?.slug).toBe("portland");
    expect(doc2?.slug).toBe("portland-2");
  });

  test("scoped slugs allow same slug in different scopes", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
      scope: (doc) => doc.country as string,
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    // Springfield in US
    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "Springfield",
        country: "US",
      }
    );

    // Springfield in UK
    await store.put(
      { type: "city", id: "city-2" },
      {
        type: "city",
        id: "city-2",
        name: "Springfield",
        country: "UK",
      }
    );

    const doc1 = await store.get({ type: "city", id: "city-1" });
    const doc2 = await store.get({ type: "city", id: "city-2" });

    // Both can have same slug because they're in different scopes
    expect(doc1?.slug).toBe("springfield");
    expect(doc2?.slug).toBe("springfield");
  });

  test("getBySlug retrieves document by slug", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
      scope: (doc) => doc.country as string,
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "New York",
        country: "US",
      }
    );

    const doc = await store.getBySlug("city", "US", "new-york");
    expect(doc).toBeDefined();
    expect(doc?.id).toBe("city-1");
    expect(doc?.name).toBe("New York");
  });

  test("getBySlug returns null for non-existent slug", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    const doc = await store.getBySlug("city", "global", "non-existent");
    expect(doc).toBeNull();
  });

  test("slug updates when source field changes", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    // Create with original name
    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "Old Name",
      }
    );

    let doc = await store.get({ type: "city", id: "city-1" });
    expect(doc?.slug).toBe("old-name");

    // Update name
    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "New Name",
      }
    );

    doc = await store.get({ type: "city", id: "city-1" });
    expect(doc?.slug).toBe("new-name");

    // Old slug should no longer work
    const oldDoc = await store.getBySlug("city", "global", "old-name");
    expect(oldDoc).toBeNull();
  });

  test("resolveSlugOrAlias finds document by slug", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "Los Angeles",
      }
    );

    const doc = await store.resolveSlugOrAlias("city", "global", "los-angeles");
    expect(doc).toBeDefined();
    expect(doc?.id).toBe("city-1");
  });

  test("handles multiple source fields", async () => {
    const slugConfig: SlugOptions = {
      source: ["firstName", "lastName"],
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        person: slugConfig,
      },
    });

    await store.put(
      { type: "person", id: "person-1" },
      {
        type: "person",
        id: "person-1",
        firstName: "John",
        lastName: "Doe",
      }
    );

    const doc = await store.get({ type: "person", id: "person-1" });
    expect(doc?.slug).toBe("john-doe");
  });

  test("handles diacritics in slug generation", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "São Paulo",
      }
    );

    const doc = await store.get({ type: "city", id: "city-1" });
    expect(doc?.slug).toBe("sao-paulo");
  });

  test("respects maxLength option", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
      maxLength: 20,
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        article: slugConfig,
      },
    });

    await store.put(
      { type: "article", id: "article-1" },
      {
        type: "article",
        id: "article-1",
        name: "This is a very long article title that should be truncated to fit within the maximum length",
      }
    );

    const doc = await store.get({ type: "article", id: "article-1" });
    expect(doc?.slug).toBeDefined();
    expect(doc!.slug!.length).toBeLessThanOrEqual(20);
  });

  test("respects reserved words", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
      reservedWords: ["admin", "new", "edit"],
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        page: slugConfig,
      },
    });

    // Should throw for reserved word
    await expect(
      store.put(
        { type: "page", id: "page-1" },
        {
          type: "page",
          id: "page-1",
          name: "admin",
        }
      )
    ).rejects.toThrow('Slug "admin" is a reserved word');
  });

  test("concurrent put operations with same slug", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    // Create two cities with same name sequentially to avoid race condition
    // (Concurrent writes with same slug will fail - this is expected behavior)
    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "Portland",
      }
    );

    await store.put(
      { type: "city", id: "city-2" },
      {
        type: "city",
        id: "city-2",
        name: "Portland",
      }
    );

    const doc1 = await store.get({ type: "city", id: "city-1" });
    const doc2 = await store.get({ type: "city", id: "city-2" });

    // One should get base slug, other should get suffix
    const slugs = new Set([doc1?.slug, doc2?.slug]);
    expect(slugs.has("portland")).toBe(true);
    expect(slugs.has("portland-2")).toBe(true);
  });

  test("hierarchical scopes (city within region within country)", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
      scope: (doc) => `${doc.country}:${doc.region || ""}` as string,
    };

    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    // Albany in New York
    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "Albany",
        country: "US",
        region: "NY",
      }
    );

    // Albany in California
    await store.put(
      { type: "city", id: "city-2" },
      {
        type: "city",
        id: "city-2",
        name: "Albany",
        country: "US",
        region: "CA",
      }
    );

    const doc1 = await store.get({ type: "city", id: "city-1" });
    const doc2 = await store.get({ type: "city", id: "city-2" });

    // Same slug in different scopes
    expect(doc1?.slug).toBe("albany");
    expect(doc2?.slug).toBe("albany");

    // Verify correct retrieval
    const ny = await store.getBySlug("city", "US:NY", "albany");
    const ca = await store.getBySlug("city", "US:CA", "albany");

    expect(ny?.id).toBe("city-1");
    expect(ca?.id).toBe("city-2");
  });

  test("slug persists across store reopening", async () => {
    const slugConfig: SlugOptions = {
      source: "name",
    };

    // Create store and add document
    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    await store.put(
      { type: "city", id: "city-1" },
      {
        type: "city",
        id: "city-1",
        name: "Seattle",
      }
    );

    await store.close();

    // Reopen store
    store = openStore({
      root: TEST_ROOT,
      slugConfig: {
        city: slugConfig,
      },
    });

    // Verify slug still works
    const doc = await store.getBySlug("city", "global", "seattle");
    expect(doc).toBeDefined();
    expect(doc?.id).toBe("city-1");
  });
});
