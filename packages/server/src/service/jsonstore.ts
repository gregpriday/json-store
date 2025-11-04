/**
 * JSON Store service adapter
 * Wraps the @jsonstore/sdk Store with additional validation and safety limits
 */

import { openStore } from "@jsonstore/sdk";
import type { Store as SDKStore, Key, Document, QuerySpec, WriteOptions } from "@jsonstore/sdk";
import { logger } from "../observability/logger.js";

// Maximum document size in bytes (1MB)
const MAX_DOCUMENT_SIZE = 1024 * 1024;

// Maximum number of IDs to return from list (prevent unbounded memory)
const MAX_LIST_IDS = 5000;

export class JsonStoreService {
  #store: SDKStore;

  constructor(dataRoot: string) {
    this.#store = openStore({ root: dataRoot });
    logger.info("service.init", { data_root: dataRoot });
  }

  /**
   * Get a document by key
   * Returns null if not found (not an error)
   */
  async get(key: Key): Promise<Document | null> {
    return this.#store.get(key);
  }

  /**
   * Put (create or update) a document
   * Validates document size before writing
   */
  async put(key: Key, doc: Document, commit?: string): Promise<void> {
    // Validate document size to prevent memory/disk abuse
    const docStr = JSON.stringify(doc);
    const docByteLength = Buffer.byteLength(docStr, "utf8");
    if (docByteLength > MAX_DOCUMENT_SIZE) {
      throw new Error(
        `Document too large: ${docByteLength} bytes exceeds limit of ${MAX_DOCUMENT_SIZE} bytes`
      );
    }

    const opts: WriteOptions = commit ? { gitCommit: commit } : {};
    await this.#store.put(key, doc, opts);
  }

  /**
   * Remove a document
   * Idempotent - does not error if document doesn't exist
   */
  async remove(key: Key, commit?: string): Promise<void> {
    try {
      const opts: WriteOptions = commit ? { gitCommit: commit } : {};
      await this.#store.remove(key, opts);
    } catch (err: any) {
      // Make deletion idempotent - if document doesn't exist, that's ok
      if (err.code === "ENOENT" || err.message?.includes("not found")) {
        logger.debug("service.remove.not_found", { key });
        return;
      }
      throw err;
    }
  }

  /**
   * List all document IDs for a type
   * Capped at MAX_LIST_IDS to prevent unbounded memory usage
   */
  async list(type: string): Promise<string[]> {
    const ids = await this.#store.list(type);

    // Cap the results to prevent unbounded memory usage
    if (ids.length > MAX_LIST_IDS) {
      logger.warn("service.list.capped", {
        type,
        total: ids.length,
        returned: MAX_LIST_IDS,
      });
      return ids.slice(0, MAX_LIST_IDS);
    }

    return ids;
  }

  /**
   * Query documents with Mango query language
   * Enforces limit and skip bounds
   */
  async query(querySpec: QuerySpec): Promise<Document[]> {
    // QuerySpec already validated by Zod schema with defaults and limits
    return this.#store.query(querySpec);
  }

  /**
   * Ensure an index exists on a field
   * Idempotent - safe to call multiple times
   */
  async ensureIndex(type: string, field: string): Promise<void> {
    await this.#store.ensureIndex(type, field);
  }
}

/**
 * Singleton service instance
 * Initialized from DATA_ROOT environment variable
 */
const DATA_ROOT = process.env.DATA_ROOT || "./data";
export const jsonStoreService = new JsonStoreService(DATA_ROOT);
