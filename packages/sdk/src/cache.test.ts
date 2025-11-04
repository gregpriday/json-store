/**
 * Tests for DocumentCache
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DocumentCache } from "./cache.js";
import type { Document } from "./types.js";
import type { Stats } from "node:fs";

// Helper to create mock Stats object
function createMockStats(mtimeMs: number, size: number): Stats {
  return {
    mtimeMs,
    size,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: mtimeMs,
    ctimeMs: mtimeMs,
    birthtimeMs: mtimeMs,
    atime: new Date(mtimeMs),
    mtime: new Date(mtimeMs),
    ctime: new Date(mtimeMs),
    birthtime: new Date(mtimeMs),
  } as Stats;
}

// Helper to create test document
function createTestDoc(type: string, id: string): Document {
  return { type, id, data: "test" };
}

describe("DocumentCache", () => {
  let cache: DocumentCache;
  let originalCacheSize: string | undefined;

  beforeEach(() => {
    // Save and clear JSONSTORE_CACHE_SIZE env var to avoid interference
    originalCacheSize = process.env.JSONSTORE_CACHE_SIZE;
    delete process.env.JSONSTORE_CACHE_SIZE;

    cache = new DocumentCache({ maxSize: 3 }); // Small cache for testing
  });

  afterEach(() => {
    // Restore original env var
    if (originalCacheSize !== undefined) {
      process.env.JSONSTORE_CACHE_SIZE = originalCacheSize;
    } else {
      delete process.env.JSONSTORE_CACHE_SIZE;
    }
  });

  describe("Basic operations", () => {
    it("should return null for cache miss", () => {
      const stats = createMockStats(1000, 100);
      const result = cache.get("/path/to/doc.json", stats);
      expect(result).toBeNull();
    });

    it("should return cached document on hit", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const stats = createMockStats(1000, 100);

      cache.set(path, doc, stats);
      const result = cache.get(path, stats);

      expect(result).toEqual(doc);
    });

    it("should delete specific entry", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const stats = createMockStats(1000, 100);

      cache.set(path, doc, stats);
      cache.delete(path);
      const result = cache.get(path, stats);

      expect(result).toBeNull();
    });

    it("should clear entire cache", () => {
      const doc1 = createTestDoc("user", "1");
      const doc2 = createTestDoc("user", "2");
      const stats = createMockStats(1000, 100);

      cache.set("/path/1.json", doc1, stats);
      cache.set("/path/2.json", doc2, stats);

      cache.clear();

      expect(cache.get("/path/1.json", stats)).toBeNull();
      expect(cache.get("/path/2.json", stats)).toBeNull();
    });
  });

  describe("Metadata-based invalidation", () => {
    it("should invalidate on mtime change", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const stats1 = createMockStats(1000, 100);
      const stats2 = createMockStats(2000, 100); // Different mtime

      cache.set(path, doc, stats1);
      expect(cache.stats().size).toBe(1);

      const result = cache.get(path, stats2);

      expect(result).toBeNull();
      // Entry should be purged from cache
      expect(cache.stats().size).toBe(0);
      // Miss counter should increment
      const cacheStats = cache.stats();
      expect(cacheStats.missRate).toBeGreaterThan(0);
    });

    it("should invalidate on size change", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const stats1 = createMockStats(1000, 100);
      const stats2 = createMockStats(1000, 200); // Different size

      cache.set(path, doc, stats1);
      const result = cache.get(path, stats2);

      expect(result).toBeNull();
    });

    it("should invalidate on both mtime and size change", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const stats1 = createMockStats(1000, 100);
      const stats2 = createMockStats(2000, 200);

      cache.set(path, doc, stats1);
      const result = cache.get(path, stats2);

      expect(result).toBeNull();
    });

    it("should handle NaN metadata gracefully", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const goodStats = createMockStats(1000, 100);
      const badStats = createMockStats(NaN, 100);

      cache.set(path, doc, goodStats);
      const result = cache.get(path, badStats);

      expect(result).toBeNull();
    });

    it("should not cache document with invalid metadata", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const badStats = createMockStats(NaN, 100);

      cache.set(path, doc, badStats);

      // Entry should not be cached
      expect(cache.stats().size).toBe(0);

      const goodStats = createMockStats(1000, 100);
      const result = cache.get(path, goodStats);

      expect(result).toBeNull();
      expect(cache.stats().size).toBe(0);
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest entry when cache is full", () => {
      const doc1 = createTestDoc("user", "1");
      const doc2 = createTestDoc("user", "2");
      const doc3 = createTestDoc("user", "3");
      const doc4 = createTestDoc("user", "4");
      const stats = createMockStats(1000, 100);

      // Cache size is 3, so adding 4 items should evict the first
      cache.set("/path/1.json", doc1, stats);
      cache.set("/path/2.json", doc2, stats);
      cache.set("/path/3.json", doc3, stats);
      cache.set("/path/4.json", doc4, stats);

      expect(cache.get("/path/1.json", stats)).toBeNull();
      expect(cache.get("/path/2.json", stats)).toEqual(doc2);
      expect(cache.get("/path/3.json", stats)).toEqual(doc3);
      expect(cache.get("/path/4.json", stats)).toEqual(doc4);
    });

    it("should move accessed entry to end (most recently used)", () => {
      const doc1 = createTestDoc("user", "1");
      const doc2 = createTestDoc("user", "2");
      const doc3 = createTestDoc("user", "3");
      const doc4 = createTestDoc("user", "4");
      const stats = createMockStats(1000, 100);

      // Fill cache
      cache.set("/path/1.json", doc1, stats);
      cache.set("/path/2.json", doc2, stats);
      cache.set("/path/3.json", doc3, stats);

      // Access doc1 to move it to end
      cache.get("/path/1.json", stats);

      // Add doc4, should evict doc2 (oldest)
      cache.set("/path/4.json", doc4, stats);

      expect(cache.get("/path/1.json", stats)).toEqual(doc1);
      expect(cache.get("/path/2.json", stats)).toBeNull();
      expect(cache.get("/path/3.json", stats)).toEqual(doc3);
      expect(cache.get("/path/4.json", stats)).toEqual(doc4);
    });

    it("should update entry without eviction when re-setting same path", () => {
      const doc1 = createTestDoc("user", "1");
      const doc2 = createTestDoc("user", "2");
      const doc3 = createTestDoc("user", "3");
      const doc1Updated = createTestDoc("user", "1-updated");
      const stats1 = createMockStats(1000, 100);
      const stats2 = createMockStats(2000, 150);

      cache.set("/path/1.json", doc1, stats1);
      cache.set("/path/2.json", doc2, stats1);
      cache.set("/path/3.json", doc3, stats1);

      // Update doc1 with new stats
      cache.set("/path/1.json", doc1Updated, stats2);

      // All entries should still be in cache
      expect(cache.get("/path/1.json", stats2)).toEqual(doc1Updated);
      expect(cache.get("/path/2.json", stats1)).toEqual(doc2);
      expect(cache.get("/path/3.json", stats1)).toEqual(doc3);
    });
  });

  describe("Memory cap", () => {
    it("should evict entries when memory limit exceeded", () => {
      // Create cache with tiny memory limit (1KB)
      const smallCache = new DocumentCache({
        maxSize: 100,
        maxMemoryMb: 0.001, // 1KB
      });

      const largeDoc = {
        type: "user",
        id: "1",
        data: "x".repeat(500), // ~500 bytes
      };
      const stats = createMockStats(1000, 100);

      // Add three large documents (should exceed 1KB limit and trigger evictions)
      smallCache.set("/path/1.json", largeDoc, stats);
      smallCache.set("/path/2.json", largeDoc, stats);
      smallCache.set("/path/3.json", largeDoc, stats);

      // At least one entry should be evicted
      const cacheStats = smallCache.stats();
      expect(cacheStats.evicted).toBeGreaterThan(0);
      expect(cacheStats.size).toBeLessThanOrEqual(3);
      expect(cacheStats.size).toBeGreaterThan(0);
    });

    it("should track memory footprint approximately", () => {
      const doc = createTestDoc("user", "123");
      const stats = createMockStats(1000, 100);

      const statsBefore = cache.stats();
      expect(statsBefore.size).toBe(0);

      cache.set("/path/1.json", doc, stats);
      cache.set("/path/2.json", doc, stats);

      const statsAfter = cache.stats();
      expect(statsAfter.size).toBe(2);
      // Should not have triggered any evictions (no memory limit set)
      expect(statsAfter.evicted).toBe(0);
    });

    it("should handle invalid maxMemoryMb values", () => {
      const doc = createTestDoc("user", "1");
      const stats = createMockStats(1000, 100);

      // Negative value should be rejected (no memory limit enforced)
      const cache1 = new DocumentCache({ maxMemoryMb: -1, maxSize: 10 });
      cache1.set("/path/1.json", doc, stats);
      cache1.set("/path/2.json", doc, stats);
      // Should accept entries normally (invalid value ignored)
      expect(cache1.stats().size).toBe(2);
      expect(cache1.stats().evicted).toBe(0);

      // Infinity should be rejected (no memory limit enforced)
      const cache2 = new DocumentCache({ maxMemoryMb: Infinity, maxSize: 10 });
      cache2.set("/path/1.json", doc, stats);
      cache2.set("/path/2.json", doc, stats);
      expect(cache2.stats().size).toBe(2);
      expect(cache2.stats().evicted).toBe(0);

      // NaN should be rejected (no memory limit enforced)
      const cache3 = new DocumentCache({ maxMemoryMb: NaN, maxSize: 10 });
      cache3.set("/path/1.json", doc, stats);
      cache3.set("/path/2.json", doc, stats);
      expect(cache3.stats().size).toBe(2);
      expect(cache3.stats().evicted).toBe(0);

      // Valid 0 should work (sets 0 byte limit, immediately evicts)
      const cache4 = new DocumentCache({ maxMemoryMb: 0 });
      cache4.set("/path/1.json", doc, stats);
      // With 0 byte memory limit, entry is immediately evicted
      expect(cache4.stats().size).toBe(0);
      expect(cache4.stats().evicted).toBe(1);
    });

    it("should handle estimateSize fallback for cyclic objects", () => {
      const doc: any = createTestDoc("user", "123");
      doc.circular = doc; // Create circular reference

      const stats = createMockStats(1000, 100);

      // Should not crash, should use fallback size
      expect(() => {
        cache.set("/path/cyclic.json", doc, stats);
      }).not.toThrow();

      // Entry should be created with fallback size
      const result = cache.get("/path/cyclic.json", stats);
      expect(result).not.toBeNull();
    });
  });

  describe("Type-scoped clearing", () => {
    it("should clear only entries for specific type", () => {
      const cacheWithRoot = new DocumentCache({
        maxSize: 10,
        root: "/data",
      });

      const userDoc = createTestDoc("user", "1");
      const postDoc = createTestDoc("post", "1");
      const stats = createMockStats(1000, 100);

      cacheWithRoot.set("/data/user/1.json", userDoc, stats);
      cacheWithRoot.set("/data/user/2.json", userDoc, stats);
      cacheWithRoot.set("/data/post/1.json", postDoc, stats);

      cacheWithRoot.clear("user");

      expect(cacheWithRoot.get("/data/user/1.json", stats)).toBeNull();
      expect(cacheWithRoot.get("/data/user/2.json", stats)).toBeNull();
      expect(cacheWithRoot.get("/data/post/1.json", stats)).toEqual(postDoc);
    });

    it("should handle type clearing without root gracefully", () => {
      const doc = createTestDoc("user", "1");
      const stats = createMockStats(1000, 100);

      cache.set("/path/user/1.json", doc, stats);
      cache.clear("user"); // Should not crash

      // Entry should still be there (no root to match)
      expect(cache.get("/path/user/1.json", stats)).toEqual(doc);
    });

    it("should normalize paths for type clearing", () => {
      const cacheWithRoot = new DocumentCache({
        maxSize: 10,
        root: "/data",
      });

      const doc = createTestDoc("user", "1");
      const stats = createMockStats(1000, 100);

      // Set with normalized posix path
      cacheWithRoot.set("/data/user/1.json", doc, stats);

      // Also set with mixed separators
      cacheWithRoot.set("/data/user/2.json".replace(/\//g, "\\"), doc, stats);

      // Clear should work for all normalized paths
      cacheWithRoot.clear("user");

      // Both should be cleared
      expect(cacheWithRoot.get("/data/user/1.json", stats)).toBeNull();
      expect(cacheWithRoot.get("/data/user/2.json".replace(/\//g, "\\"), stats)).toBeNull();
    });
  });

  describe("Statistics", () => {
    it("should track hits and misses", () => {
      const path = "/path/to/doc.json";
      const doc = createTestDoc("user", "123");
      const stats = createMockStats(1000, 100);

      cache.set(path, doc, stats);

      // 2 hits
      cache.get(path, stats);
      cache.get(path, stats);

      // 1 miss
      cache.get("/other/path.json", stats);

      const cacheStats = cache.stats();
      expect(cacheStats.hitRate).toBe(2 / 3);
      expect(cacheStats.missRate).toBe(1 / 3);
    });

    it("should track evictions", () => {
      const doc = createTestDoc("user", "1");
      const stats = createMockStats(1000, 100);

      // Overflow cache (size = 3)
      cache.set("/path/1.json", doc, stats);
      cache.set("/path/2.json", doc, stats);
      cache.set("/path/3.json", doc, stats);
      cache.set("/path/4.json", doc, stats);

      const cacheStats = cache.stats();
      expect(cacheStats.evicted).toBe(1);
    });

    it("should return current cache size", () => {
      const doc = createTestDoc("user", "1");
      const stats = createMockStats(1000, 100);

      cache.set("/path/1.json", doc, stats);
      cache.set("/path/2.json", doc, stats);

      const cacheStats = cache.stats();
      expect(cacheStats.size).toBe(2);
    });

    it("should handle zero requests gracefully", () => {
      const cacheStats = cache.stats();
      expect(cacheStats.hitRate).toBe(0);
      expect(cacheStats.missRate).toBe(0);
      expect(cacheStats.size).toBe(0);
      expect(cacheStats.evicted).toBe(0);
    });
  });

  describe("Environment variable configuration", () => {
    it("should respect JSONSTORE_CACHE_SIZE environment variable", () => {
      const originalEnv = process.env.JSONSTORE_CACHE_SIZE;

      try {
        process.env.JSONSTORE_CACHE_SIZE = "2";
        const envCache = new DocumentCache({ maxSize: 10 });

        const doc = createTestDoc("user", "1");
        const stats = createMockStats(1000, 100);

        // Try to add 3 items (env limit is 2)
        envCache.set("/path/1.json", doc, stats);
        envCache.set("/path/2.json", doc, stats);
        envCache.set("/path/3.json", doc, stats);

        // First should be evicted
        expect(envCache.get("/path/1.json", stats)).toBeNull();
        expect(envCache.stats().size).toBe(2);
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSONSTORE_CACHE_SIZE = originalEnv;
        } else {
          delete process.env.JSONSTORE_CACHE_SIZE;
        }
      }
    });

    it("should disable cache when JSONSTORE_CACHE_SIZE=0", () => {
      const originalEnv = process.env.JSONSTORE_CACHE_SIZE;

      try {
        process.env.JSONSTORE_CACHE_SIZE = "0";
        const disabledCache = new DocumentCache({ maxSize: 10 });

        const doc = createTestDoc("user", "1");
        const stats = createMockStats(1000, 100);

        disabledCache.set("/path/1.json", doc, stats);

        // Should not cache anything
        expect(disabledCache.stats().size).toBe(0);
      } finally {
        if (originalEnv !== undefined) {
          process.env.JSONSTORE_CACHE_SIZE = originalEnv;
        } else {
          delete process.env.JSONSTORE_CACHE_SIZE;
        }
      }
    });
  });

  describe("Document immutability (dev mode)", () => {
    it("should freeze documents in test environment", () => {
      const doc = createTestDoc("user", "123");
      const stats = createMockStats(1000, 100);

      cache.set("/path/to/doc.json", doc, stats);
      const cached = cache.get("/path/to/doc.json", stats);

      expect(cached).not.toBeNull();
      if (cached) {
        expect(Object.isFrozen(cached)).toBe(true);
      }
    });
  });
});
