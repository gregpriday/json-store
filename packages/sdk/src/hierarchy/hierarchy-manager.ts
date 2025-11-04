/**
 * Hierarchy manager for coordinating hierarchical index operations
 * Extends the existing IndexManager pattern
 */

import { Wal } from "./txn/wal.js";
import { IndexTxn, type DocChange } from "./txn/index-txn.js";
import { ByPathAdapter } from "./adapters/by-path-adapter.js";
import { FileLock } from "./lock.js";
import type { Key, MaterializedPath, Document } from "../types.js";

/**
 * Options for hierarchy manager
 */
export interface HierarchyManagerOptions {
  root: string;
  indent?: number;
  stableKeyOrder?: "alpha" | string[];
  maxDepth?: number;
}

/**
 * Hierarchy manager for hierarchical index operations
 */
export class HierarchyManager {
  #root: string;
  #indent: number;
  #wal: Wal;
  #lock: FileLock;
  #byPathAdapter: ByPathAdapter;

  constructor(options: HierarchyManagerOptions) {
    this.#root = options.root;
    this.#indent = options.indent ?? 2;

    // Initialize WAL
    this.#wal = new Wal(this.#root);

    // Initialize lock
    this.#lock = new FileLock(this.#root);

    // Initialize adapters
    this.#byPathAdapter = new ByPathAdapter(this.#root, this.#indent);
  }

  /**
   * Initialize hierarchy manager (recover from crashes)
   */
  async initialize(): Promise<void> {
    const recovered = await this.#wal.recover();
    if (recovered > 0) {
      console.log(`Recovered ${recovered} incomplete transactions`);
    }

    // Reap old transactions
    await this.#wal.reap();
  }

  /**
   * Put a document with hierarchical indexing
   * @param key - Document key
   * @param doc - Document to store
   * @param parentKey - Optional parent key
   * @param slug - Optional slug
   * @param oldDoc - Old document (for updates)
   */
  async putHierarchical(
    key: Key,
    doc: Document,
    _parentKey?: Key,
    _slug?: string,
    oldDoc?: Document
  ): Promise<void> {
    // Use lock to prevent concurrent writes
    return await this.#lock.withLock(async () => {
      // Path should already be computed and validated by Store
      // We just need to update the indexes

      // Create document change
      const change: DocChange = {
        key,
        newDoc: doc,
        oldDoc,
      };

      // Create transaction with adapters
      const adapters = [this.#byPathAdapter];
      const txn = new IndexTxn(this.#wal, adapters);

      try {
        // Prepare transaction
        await txn.prepare(change);

        // Commit transaction
        await txn.commit();
      } catch (err) {
        // Rollback on error
        await txn.rollback();
        throw err;
      }
    });
  }

  /**
   * Get document by materialized path
   * @param path - Materialized path
   * @returns Document ID and type if found
   */
  async getByPath(path: MaterializedPath): Promise<{ id: string; type: string } | null> {
    return await this.#byPathAdapter.get(path);
  }

  /**
   * Find document by materialized path (alias for getByPath)
   * @param path - Materialized path
   * @returns Document ID and type if found
   */
  async findByPath(path: MaterializedPath): Promise<{ id: string; type: string } | null> {
    return await this.getByPath(path);
  }

  /**
   * Rebuild hierarchical indexes
   * @param docs - All documents to index
   * @returns Number of documents indexed
   */
  async repairHierarchy(docs: Document[]): Promise<number> {
    // Filter docs with paths
    const docsWithPaths = docs
      .filter((doc) => (doc as any).path)
      .map((doc) => ({
        id: doc.id,
        type: doc.type,
        path: (doc as any).path as MaterializedPath,
      }));

    // Rebuild by-path index
    return await this.#byPathAdapter.rebuild(docsWithPaths);
  }

  /**
   * Get WAL statistics
   */
  async getWalStats(): Promise<{ pending: number; totalBytes: number }> {
    return await this.#wal.stats();
  }

  /**
   * Close hierarchy manager
   */
  async close(): Promise<void> {
    // Cleanup if needed
  }
}
