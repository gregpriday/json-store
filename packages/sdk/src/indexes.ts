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
}
