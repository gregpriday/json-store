/**
 * Index manager for equality indexes
 *
 * Stores indexes as sidecar JSON files under data/<type>/_indexes/<field>.json
 * Format: { "value": ["id1", "id2", ...], ... }
 *
 * Invariants:
 * - ID arrays are sorted and deduplicated
 * - Index files use canonical formatting (stableStringify)
 * - All updates are atomic (write-then-rename)
 * - Concurrent updates are serialized per index via mutex
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getPath } from "./query.js";
import { atomicWrite, readDocument, listFiles } from "./io.js";
import { stableStringify } from "./format.js";
import { validateName } from "./validation.js";
import type { Document } from "./types.js";
import { metrics } from "./observability/metrics.js";
import { logger } from "./observability/logs.js";

/**
 * Metadata about an index
 */
export interface IndexMetadata {
  type: string;
  field: string;
  filePath: string;
}

/**
 * Index data structure: value → document IDs
 */
export type IndexData = Record<string, string[]>;

/**
 * Slug index data structure: scope → slug → document ID
 * For scoped slugs (e.g., city slugs unique per country)
 */
export type SlugIndexData = Record<string, Record<string, string>>;

/**
 * Alias index data structure: scope → alias → document ID
 */
export type AliasIndexData = Record<string, Record<string, string>>;

/**
 * Simple in-process mutex for serializing index updates
 */
class Mutex {
  #queue: Array<() => void> = [];
  #locked = false;

  async acquire(): Promise<void> {
    if (!this.#locked) {
      this.#locked = true;
      return;
    }

    await new Promise<void>((resolve) => {
      this.#queue.push(resolve);
    });
  }

  release(): void {
    const next = this.#queue.shift();
    if (next) {
      next();
    } else {
      this.#locked = false;
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Manages equality indexes for fast query execution
 */
export class IndexManager {
  #root: string;
  #mutexes = new Map<string, Mutex>();
  #indent: number;
  #stableKeyOrder: "alpha" | string[];

  constructor(
    root: string,
    options: { indent?: number; stableKeyOrder?: "alpha" | string[] } = {}
  ) {
    this.#root = root;
    this.#indent = options.indent ?? 2;
    this.#stableKeyOrder = options.stableKeyOrder ?? "alpha";
  }

  /**
   * Get or create mutex for an index
   */
  #getMutex(type: string, field: string): Mutex {
    const key = `${type}/${field}`;
    let mutex = this.#mutexes.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.#mutexes.set(key, mutex);
    }
    return mutex;
  }

  /**
   * Build or rebuild an index for a field
   */
  async ensureIndex(type: string, field: string, docs?: Document[]): Promise<void> {
    validateName(type, "type");
    validateName(field, "id"); // Reuse validation pattern

    const startTime = performance.now();
    logger.info("index.rebuild.start", { type, field });

    const mutex = this.#getMutex(type, field);
    await mutex.withLock(async () => {
      // Load all documents if not provided
      if (!docs) {
        docs = await this.#loadAllDocs(type);
      }

      // Build index from scratch
      const index = this.#buildIndex(docs, field);

      // Write to disk
      await this.#writeIndex(type, field, index);

      // Record metrics
      const duration = performance.now() - startTime;
      metrics.recordRebuildTime(type, field, duration);

      const keys = Object.keys(index).length;
      const bytes = JSON.stringify(index).length;
      metrics.updateSize(type, field, keys, bytes);

      logger.info("index.rebuild.end", {
        type,
        field,
        details: { durationMs: duration.toFixed(2), docs: docs!.length, keys },
      });
    });
  }

  /**
   * Update index after document change (put or remove)
   */
  async updateIndex(
    type: string,
    field: string,
    docId: string,
    oldValue: any,
    newValue: any
  ): Promise<void> {
    validateName(type, "type");
    validateName(field, "id");

    const startTime = performance.now();

    const mutex = this.#getMutex(type, field);
    await mutex.withLock(async () => {
      // Read existing index (or empty if doesn't exist yet)
      let index: IndexData;
      try {
        const readStart = performance.now();
        index = await this.#readIndex(type, field);
        metrics.recordReadTime(type, field, performance.now() - readStart);
      } catch (err: any) {
        // If index doesn't exist or is corrupt, rebuild it
        if (err.code === "ENOENT" || err instanceof SyntaxError) {
          logger.warn("index.update.skip", {
            type,
            field,
            message: "Index not found or corrupt, skipping update (call ensureIndex to create)",
          });
          return;
        }
        throw err;
      }

      // Remove from old value's bucket(s)
      if (oldValue !== undefined) {
        const oldKeys = this.#serializeValue(oldValue);
        for (const oldKey of oldKeys) {
          if (index[oldKey]) {
            index[oldKey] = index[oldKey].filter((id) => id !== docId);
            if (index[oldKey].length === 0) {
              delete index[oldKey];
            }
          }
        }
      }

      // Add to new value's bucket(s)
      if (newValue !== undefined) {
        const newKeys = this.#serializeValue(newValue);
        for (const newKey of newKeys) {
          if (!index[newKey]) {
            index[newKey] = [];
          }
          if (!index[newKey].includes(docId)) {
            index[newKey].push(docId);
            // Keep sorted for deterministic output
            index[newKey].sort();
          }
        }
      }

      // Write updated index
      const writeStart = performance.now();
      await this.#writeIndex(type, field, index);
      metrics.recordWriteTime(type, field, performance.now() - writeStart);

      // Update size metrics
      const keys = Object.keys(index).length;
      const bytes = JSON.stringify(index).length;
      metrics.updateSize(type, field, keys, bytes);

      logger.debug("index.update", {
        type,
        field,
        details: { docId, durationMs: (performance.now() - startTime).toFixed(2) },
      });
    });
  }

  /**
   * Query using index (fast path for equality lookups)
   */
  async queryWithIndex(type: string, field: string, value: any): Promise<string[]> {
    validateName(type, "type");
    validateName(field, "id");

    const startTime = performance.now();

    const mutex = this.#getMutex(type, field);
    const result = await mutex.withLock(async () => {
      const readStart = performance.now();
      let index: IndexData;

      try {
        index = await this.#readIndex(type, field);
        metrics.recordReadTime(type, field, performance.now() - readStart);
      } catch (err: any) {
        // If index file is missing or corrupted, degrade gracefully to empty result
        // This handles concurrent removeIndex() or file corruption between hasIndex() check and read
        logger.debug("index.read.fallback", {
          type,
          field,
          details: { error: err.message },
        });
        return [];
      }

      const keys = this.#serializeValue(value);

      // Collect all IDs for the value (handles multi-valued fields)
      const ids = new Set<string>();
      for (const key of keys) {
        const bucket = index[key];
        if (bucket) {
          for (const id of bucket) {
            ids.add(id);
          }
        }
      }

      return Array.from(ids).sort();
    });

    const duration = performance.now() - startTime;
    metrics.recordQueryTime(type, field, duration);
    metrics.recordHit(type, field);

    logger.debug("index.query", {
      type,
      field,
      details: { durationMs: duration.toFixed(2), results: result.length },
    });

    return result;
  }

  /**
   * Check if index exists
   */
  async hasIndex(type: string, field: string): Promise<boolean> {
    const indexPath = this.#getIndexPath(type, field);
    try {
      await fs.access(indexPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rebuild all indexes for a type
   */
  async rebuildIndexes(type: string, fields?: string[]): Promise<void> {
    validateName(type, "type");

    // If fields not specified, discover existing indexes
    if (!fields || fields.length === 0) {
      const indexDir = path.join(this.#root, type, "_indexes");
      const files = await listFiles(indexDir, ".json");
      fields = files.map((f) => path.basename(f, ".json"));

      if (fields.length === 0) {
        // No indexes to rebuild
        return;
      }
    }

    // Load all documents once
    const docs = await this.#loadAllDocs(type);

    // Rebuild each index
    for (const field of fields) {
      await this.ensureIndex(type, field, docs);
    }
  }

  /**
   * Remove an index
   */
  async removeIndex(type: string, field: string): Promise<void> {
    validateName(type, "type");
    validateName(field, "id");

    const mutex = this.#getMutex(type, field);
    await mutex.withLock(async () => {
      const indexPath = this.#getIndexPath(type, field);
      try {
        await fs.unlink(indexPath);
      } catch (err: any) {
        // Idempotent: ignore if doesn't exist
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    });
  }

  /**
   * List all indexed fields for a type
   */
  async listIndexes(type: string): Promise<string[]> {
    validateName(type, "type");

    const indexDir = path.join(this.#root, type, "_indexes");
    const files = await listFiles(indexDir, ".json");
    return files.map((f) => path.basename(f, ".json"));
  }

  /**
   * Build index from documents
   */
  #buildIndex(docs: Document[], field: string): IndexData {
    const index: IndexData = {};

    for (const doc of docs) {
      const value = getPath(doc, field);
      if (value !== undefined) {
        const keys = this.#serializeValue(value);
        for (const key of keys) {
          if (!index[key]) {
            index[key] = [];
          }
          if (!index[key].includes(doc.id)) {
            index[key].push(doc.id);
          }
        }
      }
    }

    // Sort all buckets for deterministic output
    for (const key of Object.keys(index)) {
      index[key].sort();
    }

    return index;
  }

  /**
   * Serialize value to index key(s)
   * Arrays are expanded to multiple keys
   */
  #serializeValue(value: any): string[] {
    // Handle arrays: index each element separately
    if (Array.isArray(value)) {
      return value.flatMap((v) => this.#serializeValue(v));
    }

    // Scalar values
    if (typeof value === "string") {
      // Escape strings that look like type prefixes
      if (
        value.startsWith("__num__") ||
        value.startsWith("__bool__") ||
        value.startsWith("__null__")
      ) {
        return [`__str__:${value}`];
      }
      return [value];
    }

    if (typeof value === "number") {
      return [`__num__${value}`];
    }

    if (typeof value === "boolean") {
      return [`__bool__${value}`];
    }

    if (value === null) {
      return ["__null__"];
    }

    // Objects: serialize as JSON (stable ordering) but namespace to avoid collisions with strings
    if (value && typeof value === "object") {
      return [`__obj__:${stableStringify(value, 0, "alpha").trim()}`];
    }

    // Fallback for any other types (e.g. BigInt) - stringify for stability
    return [stableStringify(value, 0, "alpha").trim()];
  }

  /**
   * Read index from disk
   */
  async #readIndex(type: string, field: string): Promise<IndexData> {
    const indexPath = this.#getIndexPath(type, field);
    const content = await readDocument(indexPath);
    return JSON.parse(content);
  }

  /**
   * Write index to disk
   */
  async #writeIndex(type: string, field: string, index: IndexData): Promise<void> {
    const indexPath = this.#getIndexPath(type, field);

    // Ensure parent directory exists
    const indexDir = path.dirname(indexPath);
    await fs.mkdir(indexDir, { recursive: true });

    // Write with canonical formatting
    const content = stableStringify(index, this.#indent, this.#stableKeyOrder);
    await atomicWrite(indexPath, content);
  }

  /**
   * Get index file path
   */
  #getIndexPath(type: string, field: string): string {
    return path.join(this.#root, type, "_indexes", `${field}.json`);
  }

  /**
   * Load all documents for a type
   */
  async #loadAllDocs(type: string): Promise<Document[]> {
    const typeDir = path.join(this.#root, type);
    const files = await listFiles(typeDir, ".json");

    const docs: Document[] = [];
    for (const file of files) {
      const filePath = path.join(typeDir, file);
      try {
        const content = await readDocument(filePath);
        const doc = JSON.parse(content) as Document;
        docs.push(doc);
      } catch (err) {
        // Skip files that can't be parsed
        console.warn(`Failed to load document ${filePath}:`, err);
      }
    }

    return docs;
  }

  // ============================================================================
  // Slug Index Operations
  // ============================================================================

  /**
   * Ensure slug index exists for a type
   */
  async ensureSlugIndex(type: string): Promise<void> {
    validateName(type, "type");

    const startTime = performance.now();
    logger.info("slug_index.rebuild.start", { type });

    const mutex = this.#getMutex(type, "_slug");
    await mutex.withLock(async () => {
      // Initialize empty slug index
      const index: SlugIndexData = {};

      // Write to disk
      await this.#writeSlugIndex(type, index);

      const duration = performance.now() - startTime;
      logger.info("slug_index.rebuild.end", {
        type,
        details: { durationMs: duration.toFixed(2) },
      });
    });
  }

  /**
   * Claim a slug in a specific scope
   * Returns { ok: true } if claimed successfully
   * Returns { ok: false, holderId } if slug is already taken
   */
  async claimSlug(
    type: string,
    scopeKey: string,
    slug: string,
    docId: string
  ): Promise<{ ok: boolean; holderId?: string }> {
    validateName(type, "type");

    const startTime = performance.now();

    const mutex = this.#getMutex(type, "_slug");
    const result = await mutex.withLock(async () => {
      // Read existing index (or empty if doesn't exist yet)
      let index: SlugIndexData;
      try {
        index = await this.#readSlugIndex(type);
      } catch (err: any) {
        // If index doesn't exist, create empty one
        if (err.code === "ENOENT") {
          index = {};
        } else {
          throw err;
        }
      }

      // Ensure scope exists
      if (!index[scopeKey]) {
        index[scopeKey] = {};
      }

      // Check if slug is already taken
      const existingHolder = index[scopeKey][slug];
      if (existingHolder && existingHolder !== docId) {
        return { ok: false, holderId: existingHolder };
      }

      // Claim the slug
      index[scopeKey][slug] = docId;

      // Write updated index
      await this.#writeSlugIndex(type, index);

      logger.debug("slug_index.claim", {
        type,
        details: {
          scopeKey,
          slug,
          docId,
          durationMs: (performance.now() - startTime).toFixed(2),
        },
      });

      return { ok: true };
    });

    return result;
  }

  /**
   * Release a slug from a specific scope
   */
  async releaseSlug(type: string, scopeKey: string, slug: string, docId: string): Promise<void> {
    validateName(type, "type");

    const startTime = performance.now();

    const mutex = this.#getMutex(type, "_slug");
    await mutex.withLock(async () => {
      // Read existing index
      let index: SlugIndexData;
      try {
        index = await this.#readSlugIndex(type);
      } catch (err: any) {
        // If index doesn't exist, nothing to release
        if (err.code === "ENOENT") {
          return;
        }
        throw err;
      }

      // Remove slug if it's held by this document
      if (index[scopeKey] && index[scopeKey][slug] === docId) {
        delete index[scopeKey][slug];

        // Clean up empty scopes
        if (Object.keys(index[scopeKey]).length === 0) {
          delete index[scopeKey];
        }

        // Write updated index
        await this.#writeSlugIndex(type, index);

        logger.debug("slug_index.release", {
          type,
          details: {
            scopeKey,
            slug,
            docId,
            durationMs: (performance.now() - startTime).toFixed(2),
          },
        });
      }
    });
  }

  /**
   * Find which document holds a slug in a scope
   */
  async findSlugHolder(type: string, scopeKey: string, slug: string): Promise<string | undefined> {
    validateName(type, "type");

    const mutex = this.#getMutex(type, "_slug");
    return await mutex.withLock(async () => {
      try {
        const index = await this.#readSlugIndex(type);
        return index[scopeKey]?.[slug];
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return undefined;
        }
        throw err;
      }
    });
  }

  /**
   * Get all slugs in a scope
   */
  async getSlugsInScope(type: string, scopeKey: string): Promise<Set<string>> {
    validateName(type, "type");

    const mutex = this.#getMutex(type, "_slug");
    return await mutex.withLock(async () => {
      try {
        const index = await this.#readSlugIndex(type);
        const slugs = index[scopeKey] ? Object.keys(index[scopeKey]) : [];
        return new Set(slugs);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return new Set();
        }
        throw err;
      }
    });
  }

  /**
   * Update slug aliases for a document
   */
  async updateSlugAliases(
    type: string,
    scopeKey: string,
    add: string[],
    remove: string[],
    docId: string
  ): Promise<void> {
    validateName(type, "type");

    const startTime = performance.now();

    const slugMutex = this.#getMutex(type, "_slug");
    const aliasMutex = this.#getMutex(type, "_alias");

    await slugMutex.withLock(async () => {
      // Read canonical slug index while holding the slug lock so the view stays stable
      let slugIndex: SlugIndexData;
      try {
        slugIndex = await this.#readSlugIndex(type);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          slugIndex = {};
        } else {
          throw err;
        }
      }

      await aliasMutex.withLock(async () => {
        // Read existing alias index
        let index: AliasIndexData;
        try {
          index = await this.#readAliasIndex(type);
        } catch (err: any) {
          // If index doesn't exist, create empty one
          if (err.code === "ENOENT") {
            index = {};
          } else {
            throw err;
          }
        }

        // Ensure scope exists
        if (!index[scopeKey]) {
          index[scopeKey] = {};
        }

        // Remove aliases
        for (const alias of remove) {
          if (index[scopeKey][alias] === docId) {
            delete index[scopeKey][alias];
          }
        }

        // Add aliases
        for (const alias of add) {
          // Check if alias conflicts with existing canonical slug
          const slugHolder = slugIndex[scopeKey]?.[alias];
          if (slugHolder && slugHolder !== docId) {
            throw new Error(
              `Cannot create alias "${alias}": conflicts with canonical slug owned by ${slugHolder}`
            );
          }

          // Check if alias is already taken by another document
          const existingHolder = index[scopeKey][alias];
          if (existingHolder && existingHolder !== docId) {
            throw new Error(
              `Cannot create alias "${alias}": already taken by document ${existingHolder}`
            );
          }

          index[scopeKey][alias] = docId;
        }

        // Clean up empty scopes
        if (Object.keys(index[scopeKey]).length === 0) {
          delete index[scopeKey];
        }

        // Write updated index
        await this.#writeAliasIndex(type, index);

        logger.debug("alias_index.update", {
          type,
          details: {
            scopeKey,
            add,
            remove,
            docId,
            durationMs: (performance.now() - startTime).toFixed(2),
          },
        });
      });
    });
  }

  /**
   * Resolve a slug or alias to a document ID
   */
  async resolveSlugOrAlias(
    type: string,
    scopeKey: string,
    slugOrAlias: string
  ): Promise<string | undefined> {
    validateName(type, "type");

    // First check canonical slugs
    const slugHolder = await this.findSlugHolder(type, scopeKey, slugOrAlias);
    if (slugHolder) {
      return slugHolder;
    }

    // Then check aliases
    const mutex = this.#getMutex(type, "_alias");
    return await mutex.withLock(async () => {
      try {
        const index = await this.#readAliasIndex(type);
        return index[scopeKey]?.[slugOrAlias];
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return undefined;
        }
        throw err;
      }
    });
  }

  /**
   * Read slug index from disk
   */
  async #readSlugIndex(type: string): Promise<SlugIndexData> {
    const indexPath = this.#getSlugIndexPath(type);
    const content = await readDocument(indexPath);
    return JSON.parse(content);
  }

  /**
   * Write slug index to disk
   */
  async #writeSlugIndex(type: string, index: SlugIndexData): Promise<void> {
    const indexPath = this.#getSlugIndexPath(type);

    // Ensure parent directory exists
    const indexDir = path.dirname(indexPath);
    await fs.mkdir(indexDir, { recursive: true });

    // Write with canonical formatting
    const content = stableStringify(index, this.#indent, this.#stableKeyOrder);
    await atomicWrite(indexPath, content);
  }

  /**
   * Get slug index file path
   */
  #getSlugIndexPath(type: string): string {
    return path.join(this.#root, type, "_indexes", "_slug.json");
  }

  /**
   * Read alias index from disk
   */
  async #readAliasIndex(type: string): Promise<AliasIndexData> {
    const indexPath = this.#getAliasIndexPath(type);
    const content = await readDocument(indexPath);
    return JSON.parse(content);
  }

  /**
   * Write alias index to disk
   */
  async #writeAliasIndex(type: string, index: AliasIndexData): Promise<void> {
    const indexPath = this.#getAliasIndexPath(type);

    // Ensure parent directory exists
    const indexDir = path.dirname(indexPath);
    await fs.mkdir(indexDir, { recursive: true });

    // Write with canonical formatting
    const content = stableStringify(index, this.#indent, this.#stableKeyOrder);
    await atomicWrite(indexPath, content);
  }

  /**
   * Get alias index file path
   */
  #getAliasIndexPath(type: string): string {
    return path.join(this.#root, type, "_indexes", "_alias.json");
  }
}
