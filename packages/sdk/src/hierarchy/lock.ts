/**
 * File-based lock for preventing concurrent hierarchy transactions
 * Uses exclusive file open to ensure only one writer at a time
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Simple file-based lock using exclusive open
 */
export class FileLock {
  #lockPath: string;
  #fd?: fs.FileHandle;
  #acquired = false;

  constructor(root: string, lockName: string = "hierarchy.lock") {
    this.#lockPath = path.join(root, "_meta", lockName);
  }

  /**
   * Acquire the lock (blocking with retries)
   * @param timeoutMs - Maximum time to wait for lock (default: 30000ms)
   * @param retryIntervalMs - Time between retry attempts (default: 100ms)
   */
  async acquire(timeoutMs: number = 30000, retryIntervalMs: number = 100): Promise<void> {
    if (this.#acquired) {
      throw new Error("Lock already acquired");
    }

    const startTime = Date.now();

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(this.#lockPath), { recursive: true });

    while (true) {
      try {
        // Try to open file exclusively (fails if already exists)
        this.#fd = await fs.open(this.#lockPath, "wx");
        this.#acquired = true;

        // Write PID and timestamp for debugging
        const lockInfo = {
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        };
        await this.#fd.writeFile(JSON.stringify(lockInfo, null, 2));
        await this.#fd.sync();

        return;
      } catch (err: any) {
        if (err.code !== "EEXIST") {
          // Unexpected error
          throw err;
        }

        // Lock is held by another process - check timeout
        if (Date.now() - startTime > timeoutMs) {
          throw new Error(
            `Failed to acquire lock after ${timeoutMs}ms. ` +
              `Lock file: ${this.#lockPath}. ` +
              `This may indicate a stale lock from a crashed process - ` +
              `manually delete the lock file if safe.`
          );
        }

        // Wait and retry
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }
  }

  /**
   * Release the lock
   */
  async release(): Promise<void> {
    if (!this.#acquired) {
      return; // Nothing to release
    }

    try {
      // Close file handle
      if (this.#fd) {
        await this.#fd.close();
        this.#fd = undefined;
      }

      // Delete lock file
      await fs.unlink(this.#lockPath);
    } catch (err: any) {
      // Ignore if lock file doesn't exist (already cleaned up)
      if (err.code !== "ENOENT") {
        console.error("Failed to release lock:", err);
      }
    } finally {
      this.#acquired = false;
    }
  }

  /**
   * Check if lock is acquired
   */
  isAcquired(): boolean {
    return this.#acquired;
  }

  /**
   * Execute a function with the lock held
   * Automatically acquires and releases the lock
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }

  /**
   * Force remove a stale lock file
   * DANGEROUS - only use if you're sure the process that created it is dead
   */
  static async forceRemove(root: string, lockName: string = "hierarchy.lock"): Promise<void> {
    const lockPath = path.join(root, "_meta", lockName);
    try {
      await fs.unlink(lockPath);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  }
}
