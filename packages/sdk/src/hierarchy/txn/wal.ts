/**
 * Write-Ahead Log for atomic multi-index updates
 * Uses transaction directory approach with manifest for two-phase commit
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { atomicWrite } from "../../io.js";
import { stableStringify } from "../../format.js";

/**
 * Transaction manifest describing staged files and their target paths
 */
export interface TxnManifest {
  /** Transaction ID */
  txnId: string;
  /** Timestamp when txn started */
  timestamp: string;
  /** Staged files and their target paths */
  operations: Array<{
    /** Source path in scratch dir */
    source: string;
    /** Target path in store */
    target: string;
    /** SHA256 hash of content for verification */
    hash: string;
  }>;
}

/**
 * Write-Ahead Log manager for hierarchical transactions
 */
export class Wal {
  #walDir: string;

  constructor(root: string) {
    this.#walDir = path.join(root, "_meta", "wal");
  }

  /**
   * Begin a new transaction
   * Creates scratch directory and returns transaction ID
   * @returns Transaction ID and scratch directory path
   */
  async begin(): Promise<{ txnId: string; scratchDir: string }> {
    // Generate unique transaction ID
    const txnId = `${Date.now()}-${randomBytes(8).toString("hex")}`;
    const scratchDir = path.join(this.#walDir, txnId);

    // Create scratch directory
    await fs.mkdir(scratchDir, { recursive: true });

    return { txnId, scratchDir };
  }

  /**
   * Prepare transaction by writing manifest
   * This makes the transaction recoverable in case of crash
   * @param txnId - Transaction ID
   * @param manifest - Transaction manifest
   */
  async prepare(txnId: string, manifest: TxnManifest): Promise<void> {
    const manifestPath = path.join(this.#walDir, txnId, "manifest.json");

    // Write manifest atomically
    const content = stableStringify(manifest, 2, "alpha");
    await atomicWrite(manifestPath, content);

    // Fsync the directory to ensure manifest is durable
    try {
      const dirFd = await fs.open(path.join(this.#walDir, txnId), "r");
      await dirFd.sync();
      await dirFd.close();
    } catch (err) {
      // Fsync not supported on all platforms, continue anyway
      console.warn("Failed to fsync transaction directory:", err);
    }
  }

  /**
   * Commit transaction by renaming staged files into place
   * @param txnId - Transaction ID
   * @param manifest - Transaction manifest
   */
  async commit(txnId: string, manifest: TxnManifest): Promise<void> {
    // Rename all staged files to their target locations
    for (const op of manifest.operations) {
      const sourcePath = path.join(this.#walDir, txnId, op.source);
      const targetPath = op.target;

      // Ensure target directory exists
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      // Atomic rename
      await fs.rename(sourcePath, targetPath);
    }

    // Delete transaction directory (cleanup)
    await this.#deleteTxnDir(txnId);
  }

  /**
   * Rollback transaction by deleting scratch directory
   * @param txnId - Transaction ID
   */
  async rollback(txnId: string): Promise<void> {
    await this.#deleteTxnDir(txnId);
  }

  /**
   * Recover from crash by replaying incomplete transactions
   * Called on store startup
   * @returns Number of transactions recovered
   */
  async recover(): Promise<number> {
    let recovered = 0;

    try {
      // Ensure WAL directory exists
      await fs.mkdir(this.#walDir, { recursive: true });

      // List all transaction directories
      const entries = await fs.readdir(this.#walDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const txnId = entry.name;
        const manifestPath = path.join(this.#walDir, txnId, "manifest.json");

        try {
          // Try to read manifest
          const manifestContent = await fs.readFile(manifestPath, "utf-8");
          const manifest: TxnManifest = JSON.parse(manifestContent);

          // Replay the commit
          await this.commit(txnId, manifest);
          recovered++;
        } catch (err: any) {
          // If manifest doesn't exist or is corrupt, delete the incomplete txn
          if (err.code === "ENOENT" || err instanceof SyntaxError) {
            await this.#deleteTxnDir(txnId);
          } else {
            throw err;
          }
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    return recovered;
  }

  /**
   * Clean up old transaction directories (should be empty after commit/rollback)
   * @param maxAge - Maximum age in milliseconds (default: 1 hour)
   * @returns Number of directories cleaned
   */
  async reap(maxAge: number = 3600000): Promise<number> {
    let reaped = 0;
    const now = Date.now();

    try {
      const entries = await fs.readdir(this.#walDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const txnId = entry.name;

        // Parse timestamp from txnId (format: timestamp-random)
        const timestamp = parseInt(txnId.split("-")[0] ?? "0", 10);
        const age = now - timestamp;

        if (age > maxAge) {
          await this.#deleteTxnDir(txnId);
          reaped++;
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    return reaped;
  }

  /**
   * Delete a transaction directory recursively
   * @param txnId - Transaction ID
   */
  async #deleteTxnDir(txnId: string): Promise<void> {
    const txnDir = path.join(this.#walDir, txnId);

    try {
      await fs.rm(txnDir, { recursive: true, force: true });
    } catch (err: any) {
      // Ignore if doesn't exist
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * Get statistics about WAL state
   * @returns Statistics object
   */
  async stats(): Promise<{ pending: number; totalBytes: number }> {
    let pending = 0;
    let totalBytes = 0;

    try {
      const entries = await fs.readdir(this.#walDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        pending++;

        // Get size of transaction directory
        const txnDir = path.join(this.#walDir, entry.name);
        const files = await fs.readdir(txnDir);

        for (const file of files) {
          const filePath = path.join(txnDir, file);
          const stats = await fs.stat(filePath);
          totalBytes += stats.size;
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    return { pending, totalBytes };
  }
}
