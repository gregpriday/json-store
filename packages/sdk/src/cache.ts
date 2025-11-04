/**
 * In-memory LRU cache for parsed JSON documents with metadata-based invalidation
 */

import type { Document } from "./types.js";
import type { Stats } from "node:fs";

/**
 * Cached document entry with file metadata for invalidation
 */
export interface CacheEntry {
  /** Parsed JSON document */
  doc: Document;
  /** File modification time in milliseconds (from stats.mtimeMs) */
  mtimeMs: number;
  /** File size in bytes (from stats.size) */
  size: number;
  /** Estimated memory footprint in bytes (approximate) */
  estBytes: number;
}

/**
 * Configuration options for document cache
 */
export interface CacheOptions {
  /** Maximum number of documents to cache (default: 10000) */
  maxSize?: number;
  /** Optional memory limit in megabytes (approximate, best-effort) */
  maxMemoryMb?: number;
  /** Root directory path for type-scoped clearing */
  root?: string;
}

/**
 * Cache statistics for monitoring and debugging
 */
export interface CacheStats {
  /** Current number of cached documents */
  size: number;
  /** Cache hit rate (hits / total requests) */
  hitRate: number;
  /** Cache miss rate (misses / total requests) */
  missRate: number;
  /** Total number of evictions performed */
  evicted: number;
}

/**
 * LRU cache for parsed JSON documents with automatic invalidation
 *
 * Invalidates entries when file metadata (mtime or size) changes.
 * Uses native Map with insertion-order for O(1) LRU operations.
 * Optional best-effort memory cap based on approximate document size.
 */
export class DocumentCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private maxMemoryBytes: number | undefined;
  private runningBytes = 0;
  private hits = 0;
  private misses = 0;
  private evicted = 0;
  private root: string | undefined;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 10000;

    // Handle maxMemoryMb properly (including 0 value)
    if (options.maxMemoryMb !== undefined) {
      const maxMemory = Number(options.maxMemoryMb);
      if (Number.isFinite(maxMemory) && maxMemory >= 0) {
        this.maxMemoryBytes = maxMemory * 1024 * 1024;
      } else {
        this.maxMemoryBytes = undefined;
      }
    } else {
      this.maxMemoryBytes = undefined;
    }

    // Normalize root path (remove trailing slashes)
    this.root = options.root ? this.normalizeRootPath(options.root) : undefined;

    // Respect JSONSTORE_CACHE_SIZE environment variable
    const envCacheSize = process.env.JSONSTORE_CACHE_SIZE;
    if (envCacheSize !== undefined) {
      const size = parseInt(envCacheSize, 10);
      if (!isNaN(size)) {
        this.maxSize = size;
      }
    }
  }

  /**
   * Get document from cache if valid (metadata matches)
   *
   * @param path - Normalized absolute file path
   * @param stats - Current file stats for validation
   * @returns Cached document or null if miss/invalid
   */
  get(path: string, stats: Stats): Document | null {
    const normalizedPath = this.normalizePath(path);
    const entry = this.cache.get(normalizedPath);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Validate metadata - invalidate if changed
    if (
      !Number.isFinite(stats.mtimeMs) ||
      !Number.isFinite(stats.size) ||
      entry.mtimeMs !== stats.mtimeMs ||
      entry.size !== stats.size
    ) {
      this.cache.delete(normalizedPath);
      this.runningBytes -= entry.estBytes;
      this.misses++;
      return null;
    }

    // LRU: Move to end (most recently used)
    this.cache.delete(normalizedPath);
    this.cache.set(normalizedPath, entry);

    this.hits++;
    return entry.doc;
  }

  /**
   * Store document in cache with file metadata
   *
   * @param path - Normalized absolute file path
   * @param doc - Parsed document to cache
   * @param stats - File stats for validation
   */
  set(path: string, doc: Document, stats: Stats): void {
    const normalizedPath = this.normalizePath(path);

    // Guard against invalid metadata
    if (!Number.isFinite(stats.mtimeMs) || !Number.isFinite(stats.size)) {
      return;
    }

    // Estimate memory footprint (approximation)
    const estBytes = this.estimateSize(doc);

    // Remove existing entry if present (update case)
    const existing = this.cache.get(normalizedPath);
    if (existing) {
      this.runningBytes -= existing.estBytes;
      this.cache.delete(normalizedPath);
    }

    // Create new entry
    const entry: CacheEntry = {
      doc: this.freezeInDev(doc),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      estBytes,
    };

    // Add to cache
    this.cache.set(normalizedPath, entry);
    this.runningBytes += estBytes;

    // Evict if over limits
    this.evictIfNeeded();
  }

  /**
   * Remove specific cache entry
   *
   * @param path - Normalized absolute file path
   */
  delete(path: string): void {
    const normalizedPath = this.normalizePath(path);
    const entry = this.cache.get(normalizedPath);
    if (entry) {
      this.cache.delete(normalizedPath);
      this.runningBytes -= entry.estBytes;
    }
  }

  /**
   * Clear entire cache or entries for a specific type
   *
   * @param type - Optional entity type to clear (clears all if omitted)
   */
  clear(type?: string): void {
    if (!type) {
      // Clear entire cache
      this.cache.clear();
      this.runningBytes = 0;
      return;
    }

    // Type-scoped clearing requires root
    if (!this.root) {
      return;
    }

    // Build prefix for type directory (normalized to posix)
    // Root is already normalized without trailing slash
    const prefix = this.normalizePath(`${this.root}/${type}/`);

    // Remove all entries under this type
    for (const [path, entry] of this.cache.entries()) {
      if (path.startsWith(prefix)) {
        this.cache.delete(path);
        this.runningBytes -= entry.estBytes;
      }
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Current cache stats
   */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;
    const missRate = total > 0 ? this.misses / total : 0;

    return {
      size: this.cache.size,
      hitRate,
      missRate,
      evicted: this.evicted,
    };
  }

  /**
   * Evict oldest entries until within size and memory limits
   */
  private evictIfNeeded(): void {
    // Evict by count
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (!firstKey) break;

      const entry = this.cache.get(firstKey);
      if (entry) {
        this.runningBytes -= entry.estBytes;
      }

      this.cache.delete(firstKey);
      this.evicted++;
    }

    // Evict by memory (best-effort)
    if (this.maxMemoryBytes !== undefined) {
      while (this.cache.size > 0 && this.runningBytes > this.maxMemoryBytes) {
        const firstKey = this.cache.keys().next().value;
        if (!firstKey) break;

        const entry = this.cache.get(firstKey);
        if (entry) {
          this.runningBytes -= entry.estBytes;
        }

        this.cache.delete(firstKey);
        this.evicted++;
      }
    }
  }

  /**
   * Estimate memory footprint of a document (approximate)
   *
   * @param doc - Document to measure
   * @returns Estimated bytes
   */
  private estimateSize(doc: Document): number {
    try {
      // Approximate: JSON string length + overhead for object structure
      return Buffer.byteLength(JSON.stringify(doc)) + 32;
    } catch {
      // Fallback if stringify fails
      return 1024;
    }
  }

  /**
   * Freeze document in development to catch mutations
   *
   * @param doc - Document to freeze
   * @returns Frozen document (shallow)
   */
  private freezeInDev(doc: Document): Document {
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      return Object.freeze({ ...doc });
    }
    return doc;
  }

  /**
   * Normalize path to posix format for consistent keys
   *
   * @param path - Path to normalize
   * @returns Normalized path
   */
  private normalizePath(path: string): string {
    // Convert Windows backslashes to forward slashes
    return path.replace(/\\/g, "/");
  }

  /**
   * Normalize root path (remove trailing slashes)
   *
   * @param root - Root path to normalize
   * @returns Normalized root path without trailing slash
   */
  private normalizeRootPath(root: string): string {
    const normalized = this.normalizePath(root);
    // Keep single "/" as is, but remove trailing slashes from longer paths
    if (normalized.length > 1 && normalized.endsWith("/")) {
      return normalized.replace(/\/+$/, "");
    }
    return normalized;
  }
}
