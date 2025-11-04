/**
 * By-path index adapter for materialized path lookups
 * Stores one file per path: _indexes/by-path/<seg0>/<seg1>/.../<leaf>.json
 * Format: { "id": "<docId>", "type": "<type>" }
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IndexAdapter, DocChange } from "../txn/index-txn.js";
import type { MaterializedPath } from "../../types.js";
import { stableStringify } from "../../format.js";
import { IndexTxn } from "../txn/index-txn.js";

/**
 * By-path index entry
 */
interface ByPathEntry {
  id: string;
  type: string;
}

/**
 * By-path index adapter
 */
export class ByPathAdapter implements IndexAdapter {
  #root: string;
  #indent: number;

  constructor(root: string, indent: number = 2) {
    this.#root = root;
    this.#indent = indent;
  }

  /**
   * Prepare index updates for a document change
   */
  async prepare(
    change: DocChange,
    scratchDir: string
  ): Promise<Array<{ source: string; target: string; hash: string }>> {
    const operations: Array<{ source: string; target: string; hash: string }> = [];

    // Get materialized path from new or old document
    const newPath = this.#getPath(change.newDoc);
    const oldPath = this.#getPath(change.oldDoc);

    // If document has a path, create/update index entry
    if (newPath && change.newDoc) {
      const entry: ByPathEntry = {
        id: change.key.id,
        type: change.key.type,
      };

      const content = stableStringify(entry, this.#indent, "alpha");
      const targetPath = this.#getIndexPath(newPath);
      const relativePath = this.#pathToRelative(newPath);
      const fullRelativePath = `by-path/${relativePath}.json`;

      const op = await IndexTxn.writeStagedFile(scratchDir, fullRelativePath, content, targetPath);
      operations.push(op);
    }

    // If path changed or document deleted, remove old index entry
    // Note: Deletion happens outside WAL since we only need to remove, not atomically update
    if (oldPath && oldPath !== newPath) {
      const oldIndexPath = this.#getIndexPath(oldPath);
      try {
        await fs.unlink(oldIndexPath);
      } catch (err: any) {
        // Ignore if doesn't exist
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    }

    return operations;
  }

  /**
   * Rollback: clean up old path if document was moved/deleted
   */
  async rollback(change: DocChange): Promise<void> {
    const oldPath = this.#getPath(change.oldDoc);
    const newPath = this.#getPath(change.newDoc);

    // If path changed or document deleted, try to remove old index entry
    if (oldPath && oldPath !== newPath) {
      const indexPath = this.#getIndexPath(oldPath);
      try {
        await fs.unlink(indexPath);
      } catch (err: any) {
        // Ignore if doesn't exist
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    }
  }

  /**
   * Get document by materialized path
   * @param path - Materialized path
   * @returns Entry if found, null otherwise
   */
  async get(path: MaterializedPath): Promise<ByPathEntry | null> {
    const indexPath = this.#getIndexPath(path);

    try {
      const content = await fs.readFile(indexPath, "utf-8");
      return JSON.parse(content) as ByPathEntry;
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Extract materialized path from document
   */
  #getPath(doc?: any): MaterializedPath | undefined {
    if (!doc || typeof doc !== "object") {
      return undefined;
    }
    return doc.path as MaterializedPath | undefined;
  }

  /**
   * Get index file path for a materialized path
   */
  #getIndexPath(pathStr: MaterializedPath): string {
    const relativePath = this.#pathToRelative(pathStr);
    return path.join(this.#root, "_indexes", "by-path", `${relativePath}.json`);
  }

  /**
   * Convert materialized path to relative file path
   * Example: "/us/ny" → "us/ny"
   */
  #pathToRelative(path: MaterializedPath): string {
    if (path === "/") {
      return "root";
    }
    return path.slice(1); // Remove leading slash
  }

  /**
   * Rebuild the entire by-path index from documents
   * @param docs - All documents with paths
   */
  async rebuild(
    docs: Array<{ id: string; type: string; path?: MaterializedPath }>
  ): Promise<number> {
    let rebuilt = 0;

    // Clear existing index
    const indexDir = path.join(this.#root, "_indexes", "by-path");
    try {
      await fs.rm(indexDir, { recursive: true, force: true });
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    // Recreate index from documents
    for (const doc of docs) {
      if (!doc.path) {
        continue;
      }

      const entry: ByPathEntry = {
        id: doc.id,
        type: doc.type,
      };

      const content = stableStringify(entry, this.#indent, "alpha");
      const indexPath = this.#getIndexPath(doc.path);

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(indexPath), { recursive: true });

      // Write entry
      await fs.writeFile(indexPath, content, "utf-8");
      rebuilt++;
    }

    return rebuilt;
  }
}
