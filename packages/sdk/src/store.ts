/**
 * Main store implementation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import type {
  Store,
  StoreOptions,
  Key,
  Document,
  QuerySpec,
  WriteOptions,
  RemoveOptions,
  StoreStats,
  DetailedStats,
  FormatTarget,
} from "./types.js";
import { DocumentCache } from "./cache.js";
import { validateDocument, validateName, validateKey, validateTypeName } from "./validation.js";
import { listFiles, atomicWrite, readDocument, removeDocument } from "./io.js";
import { evaluateQuery, matches, project } from "./query.js";
import { stableStringify } from "./format.js";

const execFile = promisify(execFileCallback);

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

  async put(key: Key, doc: Document, opts?: WriteOptions): Promise<void> {
    // Validate key and document
    validateKey(key);
    validateDocument(key, doc);

    // Canonicalize document with stable formatting
    const content = stableStringify(doc, this.#options.indent, this.#options.stableKeyOrder);

    // Get file path
    const filePath = this.getFilePath(key);

    // No-op write optimization: skip write if content unchanged
    let unchanged = false;
    try {
      const prev = await readDocument(filePath);
      unchanged = prev === content;
    } catch (err: any) {
      // File doesn't exist - proceed with write
      // But rethrow other read errors (EPERM, EIO, etc.) to surface real failures
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    // Perform atomic write if content changed
    if (!unchanged) {
      await atomicWrite(filePath, content);
    }

    // Avoid serving stale data after concurrent writers; next read will repopulate safely.
    this.#cache.delete(filePath);

    // Optional git commit (non-blocking, logs errors)
    if (!unchanged && opts?.gitCommit) {
      try {
        await this.gitCommit(filePath, opts.gitCommit);
      } catch (err: any) {
        console.error("Git commit failed:", err.message);
      }
    }
  }

  async get(key: Key): Promise<Document | null> {
    validateKey(key);
    const filePath = this.getFilePath(key);

    // Retry up to 3 times if file changes during read (TOCTOU guard)
    for (let attempt = 0; attempt < 3; attempt++) {
      // Check if file exists and get initial stats
      const st1 = await fs.stat(filePath).catch((err: any) => {
        if (err?.code === "ENOENT") {
          return null;
        }
        throw err;
      });
      if (!st1 || !st1.isFile()) {
        return null;
      }

      // Try cache first (with metadata validation)
      const cached = this.#cache.get(filePath, st1);
      if (cached) {
        return cached;
      }

      // Cache miss - read from disk using readDocument for consistent error handling
      let content: string;
      try {
        content = await readDocument(filePath);
      } catch (err: any) {
        // Handle concurrent deletion (DocumentNotFoundError has code ENOENT)
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
      const st2 = await fs.stat(filePath).catch((err: any) => {
        if (err?.code === "ENOENT") {
          return null;
        }
        throw err;
      });
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

  async remove(key: Key, opts?: RemoveOptions): Promise<void> {
    validateKey(key);
    const filePath = this.getFilePath(key);

    // Remove document (idempotent - no error if doesn't exist)
    await removeDocument(filePath);

    // Clear from cache
    this.#cache.delete(filePath);

    // Optional git commit (non-blocking, logs errors)
    if (opts?.gitCommit) {
      try {
        await this.gitCommit(filePath, opts.gitCommit);
      } catch (err: any) {
        console.error("Git commit failed:", err.message);
      }
    }
  }

  async list(type: string): Promise<string[]> {
    validateName(type, "type");
    const typeDir = path.join(this.#options.root, type);

    // List all .json files
    const files = await listFiles(typeDir, ".json");

    // Extract IDs (remove .json extension) and return sorted
    return files.map((f) => path.basename(f, ".json")).sort();
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
    if (spec.type && !spec.sort && !spec.projection && this.canUseFastPath(spec.filter)) {
      const ids = this.extractIdsFromFilter(spec.filter);
      if (ids) {
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
        const result =
          spec.limit !== undefined ? docs.slice(skip, skip + spec.limit) : docs.slice(skip);

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
      // With sort: must materialize all matches, but filter during scan to avoid buffering non-matching docs
      const allDocs: Document[] = [];
      for await (const doc of this.scan(spec)) {
        if (this.matchesFilter(doc, spec.filter)) {
          allDocs.push(doc);
        }
      }

      // Use evaluateQuery for sort+paginate+project (filtering already applied)
      results = evaluateQuery(allDocs, {
        filter: {}, // Already filtered during scan
        sort: spec.sort,
        skip: spec.skip,
        limit: spec.limit,
        projection: spec.projection,
      });
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

  async stats(type?: string): Promise<StoreStats> {
    const startTime = process.env.JSONSTORE_DEBUG ? performance.now() : 0;

    if (type) {
      // Stats for specific type
      validateTypeName(type);
      const result = await this.getTypeStats(type);

      if (process.env.JSONSTORE_DEBUG) {
        const duration = performance.now() - startTime;
        console.error(
          `[JSONSTORE_DEBUG] stats: type=${type}, count=${result.count}, bytes=${result.bytes}, ${duration.toFixed(2)}ms`
        );
      }

      return result;
    }

    // Stats for all types
    const types = await this.listTypes();
    let totalCount = 0;
    let totalBytes = 0;

    // Process types with limited concurrency to avoid FD exhaustion
    const CONCURRENCY = 16;
    for (let i = 0; i < types.length; i += CONCURRENCY) {
      const batch = types.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((t) => this.getTypeStats(t)));

      for (const stats of results) {
        totalCount += stats.count;
        totalBytes += stats.bytes;
      }
    }

    if (process.env.JSONSTORE_DEBUG) {
      const duration = performance.now() - startTime;
      console.error(
        `[JSONSTORE_DEBUG] stats: type=all, types=${types.length}, count=${totalCount}, bytes=${totalBytes}, ${duration.toFixed(2)}ms`
      );
    }

    return { count: totalCount, bytes: totalBytes };
  }

  async detailedStats(): Promise<DetailedStats> {
    const startTime = process.env.JSONSTORE_DEBUG ? performance.now() : 0;

    const types = await this.listTypes();
    const typeStats: Record<string, StoreStats> = {};

    let totalCount = 0;
    let totalBytes = 0;
    let globalMin = Infinity;
    let globalMax = 0;

    // Process types with limited concurrency
    const CONCURRENCY = 16;
    for (let i = 0; i < types.length; i += CONCURRENCY) {
      const batch = types.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (type) => {
          const detailed = await this.scanType(type);
          return { type, ...detailed };
        })
      );

      for (const result of results) {
        typeStats[result.type] = { count: result.count, bytes: result.bytes };
        totalCount += result.count;
        totalBytes += result.bytes;
        if (result.count > 0) {
          globalMin = Math.min(globalMin, result.minBytes);
          globalMax = Math.max(globalMax, result.maxBytes);
        }
      }
    }

    if (process.env.JSONSTORE_DEBUG) {
      const duration = performance.now() - startTime;
      console.error(
        `[JSONSTORE_DEBUG] detailedStats: types=${types.length}, count=${totalCount}, bytes=${totalBytes}, ${duration.toFixed(2)}ms`
      );
    }

    return {
      count: totalCount,
      bytes: totalBytes,
      avgBytes: totalCount > 0 ? totalBytes / totalCount : 0,
      minBytes: globalMin === Infinity ? 0 : globalMin,
      maxBytes: globalMax,
      types: typeStats,
    };
  }

  async close(): Promise<void> {
    // Cleanup resources (file watchers, cache, etc.)
    this.#cache.clear();
  }

  /**
   * Get statistics for a specific type
   * @param type - Type name
   * @returns Statistics for the type
   */
  private async getTypeStats(type: string): Promise<StoreStats> {
    const result = await this.scanType(type);
    return { count: result.count, bytes: result.bytes };
  }

  /**
   * Scan a type directory and collect detailed statistics
   * @param type - Type name
   * @returns Detailed scan results
   */
  private async scanType(
    type: string
  ): Promise<{ count: number; bytes: number; minBytes: number; maxBytes: number }> {
    const typeDir = path.join(this.#options.root, type);

    // Check directory metadata without following symlinks
    const dirStats = await fs.lstat(typeDir).catch((err: any) => {
      if (err.code === "ENOENT") {
        return null;
      }
      throw err;
    });

    if (!dirStats) {
      return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
    }

    if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
      if (process.env.JSONSTORE_DEBUG) {
        console.warn(`[JSONSTORE_DEBUG] Skipping unsafe type directory: ${typeDir}`);
      }
      return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
    }

    const realTypeDir = await fs.realpath(typeDir).catch((err: any) => {
      if (err.code === "ENOENT") {
        return null;
      }
      throw err;
    });

    if (!realTypeDir) {
      return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
    }

    const realRootDir = await fs.realpath(this.#options.root);
    const relativeDir = path.relative(realRootDir, realTypeDir);
    if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
      throw new Error(`Type directory resolves outside of store root: ${type}`);
    }

    let count = 0;
    let bytes = 0;
    let minBytes = Infinity;
    let maxBytes = 0;
    let skippedFiles = 0;

    try {
      // Use opendir for streaming to avoid memory spikes with large directories
      const dir = await fs.opendir(realTypeDir);

      for await (const entry of dir) {
        // Only process .json files
        if (!entry.name.endsWith(".json")) {
          continue;
        }

        // Get file stats using lstat to avoid following symlinks
        const filePath = path.join(realTypeDir, entry.name);
        try {
          const stats = await fs.lstat(filePath);

          // Skip anything that isn't a regular file (covers symlinks, directories, sockets, etc.)
          if (!stats.isFile()) {
            if (process.env.JSONSTORE_DEBUG) {
              console.warn(`[JSONSTORE_DEBUG] Skipping non-file: ${filePath}`);
            }
            skippedFiles++;
            continue;
          }

          count++;
          bytes += stats.size;
          minBytes = Math.min(minBytes, stats.size);
          maxBytes = Math.max(maxBytes, stats.size);
        } catch (err: any) {
          // Handle transient errors (file deleted between readdir and lstat)
          if (err.code === "ENOENT") {
            if (process.env.JSONSTORE_DEBUG) {
              console.warn(`[JSONSTORE_DEBUG] File disappeared during scan: ${filePath}`);
            }
            skippedFiles++;
            continue;
          }
          // Log other errors but continue scanning
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`[JSONSTORE_DEBUG] Error stating file ${filePath}:`, err.message);
          }
          skippedFiles++;
        }
      }
    } catch (err: any) {
      // Directory disappeared or became inaccessible during scan
      if (err.code === "ENOENT") {
        return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
      }
      throw err;
    }

    if (process.env.JSONSTORE_DEBUG && skippedFiles > 0) {
      console.warn(`[JSONSTORE_DEBUG] Skipped ${skippedFiles} files in ${type}`);
    }

    return {
      count,
      bytes,
      minBytes: count > 0 ? minBytes : 0,
      maxBytes: count > 0 ? maxBytes : 0,
    };
  }

  /**
   * List all types (directories) in the store
   * @returns Array of type names
   */
  private async listTypes(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.#options.root, { withFileTypes: true });

      // Filter to directories only, exclude _meta and hidden directories
      // Also exclude symlinks for security
      const types: string[] = [];

      for (const entry of entries) {
        // Skip symlinks for security
        if (entry.isSymbolicLink()) {
          continue;
        }

        // Skip internal and hidden directories
        if (entry.name.startsWith("_") || entry.name.startsWith(".")) {
          continue;
        }

        // Only include directories
        if (!entry.isDirectory()) {
          continue;
        }

        // Validate type name
        try {
          validateTypeName(entry.name);
          types.push(entry.name);
        } catch {
          // Skip invalid type names
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`Skipping invalid type name: ${entry.name}`);
          }
        }
      }

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
    const resolvedPath = path.resolve(filePath);

    // Double-check: ensure resolved path is still under root
    const relative = path.relative(this.#options.root, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal detected: resolved path "${resolvedPath}" is outside root "${this.#options.root}"`
      );
    }

    return resolvedPath.replace(/\\/g, "/");
  }

  /**
   * Commit a file change to git (optional, non-blocking)
   * @param filePath - File path to commit
   * @param message - Commit message
   */
  private async gitCommit(filePath: string, message: string): Promise<void> {
    // Run git commands from the store root directory
    const cwd = this.#options.root;

    try {
      // Add file to staging (handles both additions and removals)
      await execFile("git", ["add", "-A", "--", filePath], { cwd });

      // Commit only this file (--only ensures we don't commit other staged changes)
      await execFile("git", ["commit", "--only", "-m", message, "--", filePath], { cwd });
    } catch (err) {
      // On failure, unstage the file to keep the index clean
      try {
        await execFile("git", ["reset", "--", filePath], { cwd });
      } catch {
        // Ignore reset errors
      }
      throw err;
    }
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
