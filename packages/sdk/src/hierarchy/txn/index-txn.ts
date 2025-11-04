/**
 * Transaction abstraction for atomic multi-index updates
 * Uses pluggable IndexAdapter pattern for different index types
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Wal, type TxnManifest } from "./wal.js";
import type { Document, Key } from "../../types.js";

/**
 * Document change descriptor for index updates
 */
export interface DocChange {
  /** Document key */
  key: Key;
  /** New document (undefined for delete) */
  newDoc?: Document;
  /** Old document (undefined for create) */
  oldDoc?: Document;
}

/**
 * Index adapter interface - each index type implements this
 */
export interface IndexAdapter {
  /**
   * Prepare index updates for a document change
   * Writes staged files to scratchDir
   * @param change - Document change
   * @param scratchDir - Scratch directory for staging files
   * @returns Array of operations (source, target, hash)
   */
  prepare(
    change: DocChange,
    scratchDir: string
  ): Promise<Array<{ source: string; target: string; hash: string }>>;

  /**
   * Rollback any side effects (e.g., release locks)
   * @param change - Document change
   */
  rollback?(change: DocChange): Promise<void>;
}

/**
 * Index transaction manager
 * Coordinates atomic updates across multiple index adapters
 */
export class IndexTxn {
  #wal: Wal;
  #adapters: IndexAdapter[];
  #txnId?: string;
  #manifest?: TxnManifest;

  constructor(wal: Wal, adapters: IndexAdapter[]) {
    this.#wal = wal;
    this.#adapters = adapters;
  }

  /**
   * Prepare transaction for a document change
   * @param change - Document change
   * @returns Transaction ID
   */
  async prepare(change: DocChange): Promise<string> {
    // Begin WAL transaction
    const { txnId, scratchDir } = await this.#wal.begin();
    this.#txnId = txnId;

    // Collect operations from all adapters
    const allOperations: TxnManifest["operations"] = [];
    const preparedAdapters: IndexAdapter[] = [];

    try {
      // Prepare all adapters - track which ones succeed
      for (const adapter of this.#adapters) {
        const ops = await adapter.prepare(change, scratchDir);
        allOperations.push(...ops);
        preparedAdapters.push(adapter);
      }

      // Build manifest
      this.#manifest = {
        txnId,
        timestamp: new Date().toISOString(),
        operations: allOperations,
      };

      // Write manifest (makes txn recoverable)
      await this.#wal.prepare(txnId, this.#manifest);

      return txnId;
    } catch (err) {
      // Rollback adapters that succeeded before the failure
      for (const adapter of preparedAdapters) {
        if (adapter.rollback) {
          try {
            await adapter.rollback(change);
          } catch (rollbackErr) {
            // Log but don't fail - best effort rollback
            console.error("Adapter rollback failed during prepare error:", rollbackErr);
          }
        }
      }

      // Clean up WAL
      await this.#wal.rollback(txnId);

      // Clear state
      this.#txnId = undefined;
      this.#manifest = undefined;

      throw err;
    }
  }

  /**
   * Commit transaction by renaming staged files
   * If commit fails partway through, WAL recovery will replay on restart
   */
  async commit(): Promise<void> {
    if (!this.#txnId || !this.#manifest) {
      throw new Error("No transaction in progress");
    }

    // Commit via WAL - this is atomic per file but not across all files
    // If we crash during commit, WAL recovery will replay the remaining renames
    await this.#wal.commit(this.#txnId, this.#manifest);

    // Clear state
    this.#txnId = undefined;
    this.#manifest = undefined;
  }

  /**
   * Rollback transaction by cleaning up scratch dir and releasing locks
   */
  async rollback(): Promise<void> {
    if (!this.#txnId) {
      return; // Nothing to rollback
    }

    // Call rollback on adapters (e.g., release locks)
    for (const adapter of this.#adapters) {
      if (adapter.rollback) {
        try {
          await adapter.rollback({} as DocChange); // Pass empty change
        } catch (err) {
          // Log but don't fail
          console.warn("Adapter rollback failed:", err);
        }
      }
    }

    // Rollback via WAL (deletes scratch dir)
    await this.#wal.rollback(this.#txnId);

    // Clear state
    this.#txnId = undefined;
    this.#manifest = undefined;
  }

  /**
   * Compute SHA256 hash of file content
   * @param filePath - File path
   * @returns Hex-encoded hash
   */
  static async hashFile(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Compute SHA256 hash of string content
   * @param content - String content
   * @returns Hex-encoded hash
   */
  static hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Helper to write a staged file and return operation descriptor
   * @param scratchDir - Scratch directory
   * @param relativePath - Relative path within scratch dir
   * @param content - File content
   * @param targetPath - Final target path in store
   * @returns Operation descriptor
   */
  static async writeStagedFile(
    scratchDir: string,
    relativePath: string,
    content: string,
    targetPath: string
  ): Promise<{ source: string; target: string; hash: string }> {
    // Build full source path
    const sourcePath = path.join(scratchDir, relativePath);

    // Ensure scratch directory itself exists
    await fs.mkdir(scratchDir, { recursive: true });

    // Ensure parent directory exists for source file
    const sourceDir = path.dirname(sourcePath);
    await fs.mkdir(sourceDir, { recursive: true });

    // Write content
    await fs.writeFile(sourcePath, content, "utf-8");

    // Compute hash
    const hash = IndexTxn.hashContent(content);

    // Ensure parent directory exists for target (so rename doesn't fail)
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });

    return {
      source: relativePath, // Relative to scratch dir
      target: targetPath, // Absolute path in store
      hash,
    };
  }
}
