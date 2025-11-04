/**
 * Hierarchy manager for coordinating hierarchical index operations
 * Extends the existing IndexManager pattern
 */

import { Wal } from "./txn/wal.js";
import { IndexTxn, type DocChange } from "./txn/index-txn.js";
import { ByPathAdapter } from "./adapters/by-path-adapter.js";
import type { Key, MaterializedPath, Document, Slug } from "../types.js";
import { computePath } from "./codec.js";
import { validatePathDepth } from "../validation.js";

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
  #maxDepth: number;
  #wal: Wal;
  #byPathAdapter: ByPathAdapter;

  constructor(options: HierarchyManagerOptions) {
    this.#root = options.root;
    this.#indent = options.indent ?? 2;
    this.#maxDepth = options.maxDepth ?? 32;

    // Initialize WAL
    this.#wal = new Wal(this.#root);

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
    parentKey?: Key,
    slug?: Slug,
    oldDoc?: Document
  ): Promise<void> {
    // Compute materialized path if slug provided
    let materializedPath: MaterializedPath | undefined;

    if (slug) {
      // Get parent's path
      const parentPath = parentKey ? await this.#getParentPath(parentKey) : undefined;

      // Compute this document's path
      materializedPath = computePath(parentPath, slug);

      // Validate depth
      validatePathDepth(materializedPath, this.#maxDepth);

      // Add path to document
      (doc as any).path = materializedPath;
    }

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
   * Get parent's materialized path
   * @param _parentKey - Parent key
   * @returns Parent's materialized path
   */
  async #getParentPath(_parentKey: Key): Promise<MaterializedPath | undefined> {
    // This would need to load the parent document to get its path
    // For now, we'll assume the parent path is passed in or loaded separately
    // TODO: Load parent document to get path
    return undefined;
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
