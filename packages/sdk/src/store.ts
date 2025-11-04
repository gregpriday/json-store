/**
 * Main store implementation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  Store,
  StoreOptions,
  Key,
  Document,
  QuerySpec,
  WriteOptions,
  RemoveOptions,
  StoreStats,
  FormatTarget,
} from "./types.js";
import { DocumentCache } from "./cache.js";
import { validateDocument } from "./validation.js";

/**
 * Placeholder store implementation
 * Full implementation will be added in Stage 2-3
 */
class JSONStore implements Store {
  #options: Required<StoreOptions>;
  #cache: DocumentCache;

  constructor(options: StoreOptions) {
    // Resolve root to absolute path for consistent cache keys
    const resolvedRoot = path.resolve(options.root);

    this.#options = {
      root: resolvedRoot,
      indent: options.indent ?? 2,
      stableKeyOrder: options.stableKeyOrder ?? "alpha",
      watch: options.watch ?? false,
    };

    // Initialize cache with default settings
    // JSONSTORE_CACHE_SIZE=0 disables caching
    this.#cache = new DocumentCache({
      maxSize: 10000,
      root: resolvedRoot,
    });
  }

  get options(): Required<StoreOptions> {
    return this.#options;
  }

  async put(key: Key, _doc: Document, _opts?: WriteOptions): Promise<void> {
    // Full implementation will be added later
    // For now, invalidate cache on write
    const filePath = this.getFilePath(key);
    this.#cache.delete(filePath);
    throw new Error("Not implemented yet");
  }

  async get(key: Key): Promise<Document | null> {
    const filePath = this.getFilePath(key);

    // Retry up to 3 times if file changes during read (TOCTOU guard)
    for (let attempt = 0; attempt < 3; attempt++) {
      // Check if file exists and get initial stats
      const st1 = await fs.stat(filePath).catch(() => null);
      if (!st1 || !st1.isFile()) {
        return null;
      }

      // Try cache first (with metadata validation)
      const cached = this.#cache.get(filePath, st1);
      if (cached) {
        return cached;
      }

      // Cache miss - read from disk
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf8");
      } catch (err: any) {
        // Handle concurrent deletion
        if (err.code === "ENOENT") {
          return null;
        }
        throw err;
      }

      // Parse document with better error messages
      let doc: Document;
      try {
        doc = JSON.parse(content) as Document;
      } catch (err: any) {
        throw new Error(`Failed to parse JSON document at ${filePath}: ${err.message}`);
      }

      // Validate document has required fields and matches key
      try {
        validateDocument(key, doc);
      } catch (err: any) {
        throw new Error(`Document validation failed for ${filePath}: ${err.message}`);
      }

      // TOCTOU guard: re-check stats after reading
      // If file changed during read, retry (unless this is last attempt)
      const st2 = await fs.stat(filePath).catch(() => null);
      if (st2 && st2.mtimeMs === st1.mtimeMs && st2.size === st1.size) {
        // Stats match - safe to cache and return
        this.#cache.set(filePath, doc, st2);
        return doc;
      }

      // Stats don't match - file changed during read
      // Retry unless this was the last attempt
      if (attempt === 2) {
        // Last attempt - return without caching
        return doc;
      }
    }

    // Should never reach here, but TypeScript needs a return
    return null;
  }

  async remove(key: Key, _opts?: RemoveOptions): Promise<void> {
    // Full implementation will be added later
    // For now, invalidate cache on remove
    const filePath = this.getFilePath(key);
    this.#cache.delete(filePath);
    throw new Error("Not implemented yet");
  }

  async list(_type: string): Promise<string[]> {
    throw new Error("Not implemented yet");
  }

  async query(_query: QuerySpec): Promise<Document[]> {
    throw new Error("Not implemented yet");
  }

  async ensureIndex(_type: string, _field: string): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async rebuildIndexes(_type: string, _fields?: string[]): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async format(_target?: FormatTarget): Promise<void> {
    throw new Error("Not implemented yet");
  }

  async stats(_type?: string): Promise<StoreStats> {
    throw new Error("Not implemented yet");
  }

  async close(): Promise<void> {
    // Cleanup resources (file watchers, cache, etc.)
    this.#cache.clear();
  }

  /**
   * Get absolute file path for a document key
   * @param key - Document key
   * @returns Normalized absolute file path
   * @throws {Error} If key contains path traversal sequences
   */
  private getFilePath(key: Key): string {
    // Validate key components to prevent path traversal
    if (
      key.type.includes("..") ||
      key.type.includes("/") ||
      key.type.includes("\\") ||
      path.isAbsolute(key.type)
    ) {
      throw new Error(
        `Invalid key.type "${key.type}": must not contain path traversal sequences or separators`
      );
    }
    if (
      key.id.includes("..") ||
      key.id.includes("/") ||
      key.id.includes("\\") ||
      path.isAbsolute(key.id)
    ) {
      throw new Error(
        `Invalid key.id "${key.id}": must not contain path traversal sequences or separators`
      );
    }

    // Build path: root/type/id.json
    const filePath = path.join(this.#options.root, key.type, `${key.id}.json`);
    // Normalize to absolute path with posix separators for cache key consistency
    const resolvedPath = path.resolve(filePath).replace(/\\/g, "/");

    // Double-check: ensure resolved path is still under root
    const normalizedRoot = this.#options.root.replace(/\\/g, "/");
    if (!resolvedPath.startsWith(normalizedRoot + "/")) {
      throw new Error(
        `Path traversal detected: resolved path "${resolvedPath}" is outside root "${normalizedRoot}"`
      );
    }

    return resolvedPath;
  }
}

/**
 * Open a JSON store
 * @param options - Store configuration options
 * @returns Store instance
 */
export function openStore(options: StoreOptions): Store {
  return new JSONStore(options);
}
