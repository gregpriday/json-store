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
import { validateDocument, validateName, validateKey } from "./validation.js";
import { listFiles, atomicWrite } from "./io.js";
import { evaluateQuery, matches, project } from "./query.js";
import { stableStringify } from "./format.js";

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

  async put(key: Key, doc: Document, _opts?: WriteOptions): Promise<void> {
    // Validate key
    validateKey(key);

    // Validate document matches key
    validateDocument(key, doc);

    // Get file path
    const filePath = this.getFilePath(key);

    // Serialize document with stable key ordering
    const content = stableStringify(doc, this.#options.indent, this.#options.stableKeyOrder);

    // Write atomically
    await atomicWrite(filePath, content);

    // Invalidate cache
    this.#cache.delete(filePath);
  }

  async get(key: Key): Promise<Document | null> {
    const filePath = this.getFilePath(key);

    // Retry up to 3 times if file changes during read (TOCTOU guard)
    for (let attempt = 0; attempt < 3; attempt++) {
      // Check if file exists and get initial stats
      let st1;
      try {
        st1 = await fs.stat(filePath);
        if (!st1.isFile()) {
          return null;
        }
      } catch (err: any) {
        // Only treat ENOENT as "not found", surface other errors
        if (err.code === "ENOENT" || err.code === "ENOTDIR") {
          return null;
        }
        throw err;
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
      let st2;
      try {
        st2 = await fs.stat(filePath);
      } catch (err: any) {
        // File may have been deleted during read
        if (err.code === "ENOENT") {
          return null;
        }
        // Other errors should be surfaced
        throw err;
      }

      if (st2.mtimeMs === st1.mtimeMs && st2.size === st1.size) {
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

  async list(type: string): Promise<string[]> {
    // Validate type name
    validateName(type, "type");

    // Get directory path for this type
    const typePath = path.join(this.#options.root, type);

    // List all .json files in the directory
    const files = await listFiles(typePath, ".json");

    // Strip .json extension and return sorted IDs
    return files.map((file) => file.slice(0, -5)).sort();
  }

  async query(spec: QuerySpec): Promise<Document[]> {
    const startTime = process.env.JSONSTORE_DEBUG ? performance.now() : 0;

    // Validate input
    if (!spec.filter || typeof spec.filter !== "object") {
      throw new Error("query() requires a filter object");
    }

    if (spec.skip !== undefined && (typeof spec.skip !== "number" || spec.skip < 0)) {
      throw new Error("skip must be a non-negative number");
    }

    if (spec.limit !== undefined && (typeof spec.limit !== "number" || spec.limit <= 0)) {
      throw new Error("limit must be a positive number");
    }

    // Validate type if provided
    if (spec.type) {
      validateName(spec.type, "type");
    }

    // Check for fast path: single type, simple ID-based filter, no sort/projection
    let usedFastPath = false;
    if (
      spec.type &&
      !spec.sort &&
      !spec.projection &&
      this.canUseFastPath(spec.filter)
    ) {
      const ids = this.extractIdsFromFilter(spec.filter);
      if (ids) {
        usedFastPath = true;
        const docs: Document[] = [];

        for (const id of ids) {
          const doc = await this.get({ type: spec.type, id });
          if (doc && matches(doc, spec.filter)) {
            docs.push(doc);
          }
        }

        // Sort by ID for stable ordering
        docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

        // Apply pagination
        const skip = spec.skip ?? 0;
        const result = spec.limit !== undefined ? docs.slice(skip, skip + spec.limit) : docs.slice(skip);

        if (process.env.JSONSTORE_DEBUG) {
          const duration = performance.now() - startTime;
          console.error(
            `[JSONSTORE_DEBUG] query: ${result.length} results, ${duration.toFixed(2)}ms, fastPath=true, type=${spec.type}`
          );
        }

        return result;
      }
    }

    // General path: evaluate query with full scan
    let results: Document[];

    if (!spec.sort) {
      // No sort: can use streaming with early termination
      const matches: Document[] = [];
      const skip = spec.skip ?? 0;
      const limit = spec.limit;
      let skipped = 0;
      let taken = 0;

      for await (const doc of this.scan(spec)) {
        if (this.matchesFilter(doc, spec.filter)) {
          if (skipped < skip) {
            skipped++;
          } else if (limit === undefined || taken < limit) {
            matches.push(doc);
            taken++;
            if (limit !== undefined && taken >= limit) {
              break;
            }
          }
        }
      }

      // Apply projection if needed
      results = spec.projection ? matches.map((d) => project(d, spec.projection)) : matches;
    } else {
      // With sort: must materialize all matches
      const allDocs: Document[] = [];
      for await (const doc of this.scan(spec)) {
        allDocs.push(doc);
      }

      // Use evaluateQuery for full filter+sort+paginate+project
      results = evaluateQuery(allDocs, spec);
    }

    if (process.env.JSONSTORE_DEBUG) {
      const duration = performance.now() - startTime;
      console.error(
        `[JSONSTORE_DEBUG] query: ${results.length} results, ${duration.toFixed(2)}ms, fastPath=false, type=${spec.type ?? "all"}, sort=${!!spec.sort}`
      );
    }

    return results;
  }

  /**
   * Check if a filter can use the fast path (ID-only filter)
   */
  private canUseFastPath(filter: any): boolean {
    // Fast path only for simple id filters: { id: { $eq: "x" } } or { id: { $in: [...] } }
    if (!filter || typeof filter !== "object") return false;

    const keys = Object.keys(filter);
    if (keys.length !== 1 || keys[0] !== "id") return false;

    const idFilter = filter.id;
    if (!idFilter || typeof idFilter !== "object") return false;

    const ops = Object.keys(idFilter);
    return ops.length === 1 && (ops[0] === "$eq" || ops[0] === "$in");
  }

  /**
   * Extract IDs from a fast-path filter
   */
  private extractIdsFromFilter(filter: any): string[] | null {
    if (!filter?.id) return null;

    const idFilter = filter.id;
    if (idFilter.$eq !== undefined) {
      return [String(idFilter.$eq)];
    }
    if (Array.isArray(idFilter.$in)) {
      return Array.from(new Set(idFilter.$in.map(String)));
    }

    return null;
  }

  /**
   * Test if document matches filter (wrapper for query.matches)
   */
  private matchesFilter(doc: Document, filter: any): boolean {
    return matches(doc, filter);
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
   * List all types (directories) in the store
   * @returns Array of type names
   */
  private async listTypes(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.#options.root, { withFileTypes: true });

      // Filter to directories only, exclude _meta and hidden directories
      const types = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .filter((name) => {
          // Validate each type name
          try {
            validateName(name, "type");
            return true;
          } catch {
            return false;
          }
        });

      return types.sort();
    } catch (err: any) {
      // If root doesn't exist yet, return empty array
      if (err.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * Scan documents matching a query spec
   * @param spec - Query specification
   * @yields Documents from disk/cache
   */
  private async *scan(spec: QuerySpec): AsyncIterable<Document> {
    // Determine which types to scan
    const types = spec.type ? [spec.type] : await this.listTypes();

    // Scan each type
    for (const type of types) {
      const ids = await this.list(type);

      // Read each document
      for (const id of ids) {
        const doc = await this.get({ type, id });
        if (doc) {
          yield doc;
        }
      }
    }
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
    // Normalize to absolute path
    const resolvedPath = path.resolve(filePath);

    // Double-check: ensure resolved path is still under root using path.relative
    // This works correctly regardless of whether root has trailing separator
    const relativePath = path.relative(this.#options.root, resolvedPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(
        `Path traversal detected: resolved path "${resolvedPath}" is outside root "${this.#options.root}"`
      );
    }

    // Normalize to posix separators for cache key consistency
    const normalizedPath = resolvedPath.replace(/\\/g, "/");

    return normalizedPath;
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
