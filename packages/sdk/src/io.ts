/**
 * Atomic file I/O operations for crash-safe writes
 *
 * Invariants:
 * - Writes are atomic: never observe partial file contents
 * - Temp files always reside in the same directory as target (same filesystem for atomic rename)
 * - Temp files are removed on failure paths
 * - Reads are UTF-8 only; missing files throw DocumentNotFoundError
 * - Removes are idempotent
 *
 * Pattern: write → fsync → rename → fsync directory
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import {
  DocumentNotFoundError,
  DocumentReadError,
  DocumentWriteError,
  DocumentRemoveError,
  DirectoryError,
  ListFilesError,
} from "./errors.js";

/**
 * Feature flag to control directory fsync (can be disabled on problematic platforms)
 */
const ENABLE_DIR_FSYNC = true;

/**
 * Ensure a directory exists, creating it and parent directories as needed
 * @param dirPath - Directory path to create
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  if (!dirPath || typeof dirPath !== "string") {
    throw new DirectoryError(String(dirPath), {
      cause: new TypeError("Directory path must be a non-empty string"),
    });
  }

  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    throw new DirectoryError(dirPath, { cause: err });
  }
}

/**
 * Atomically write content to a file using write-rename-sync pattern
 * @param filePath - Target file path
 * @param content - Content to write (UTF-8 string)
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  const base = basename(filePath);
  const tmp = join(dir, `.${base}.${randomUUID()}.tmp`);

  // Ensure the directory exists
  await ensureDirectory(dir);

  let fileHandle: fs.FileHandle | null = null;

  try {
    // Write to temp file
    fileHandle = await fs.open(tmp, "w", 0o600);
    await fileHandle.writeFile(content, "utf-8");

    // Sync file data to disk (prefer datasync for performance, fall back to sync)
    try {
      await fileHandle.datasync();
    } catch (err: any) {
      // If datasync is not supported, fall back to full sync
      // ENOTSUP/ENOSYS: not supported on this platform
      // EINVAL: some CIFS/FUSE mounts report this instead
      if (err.code === "ENOTSUP" || err.code === "ENOSYS" || err.code === "EINVAL") {
        await fileHandle.sync();
      } else {
        throw err;
      }
    }

    // Close the file handle before rename
    await fileHandle.close();
    fileHandle = null;

    // Atomic rename (last-writer-wins for concurrent writes)
    try {
      await fs.rename(tmp, filePath);
    } catch (err: any) {
      // On Windows, rename may fail transiently when antivirus or indexing grabs the file
      // EPERM: permission denied (file in use)
      // EACCES: access denied (locked by another process)
      // EBUSY: resource busy (being scanned/indexed)
      if (
        (err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY") &&
        process.platform === "win32"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await fs.rename(tmp, filePath);
      } else {
        throw err;
      }
    }

    // Optionally fsync parent directory for maximum durability (best-effort)
    if (ENABLE_DIR_FSYNC) {
      try {
        const dirHandle = await fs.open(dir, "r");
        try {
          await dirHandle.sync();
        } finally {
          await dirHandle.close();
        }
      } catch (err: any) {
        // Ignore errors for platforms that don't support directory fsync
        // Common error codes: EINVAL (invalid operation), ENOTSUP (not supported)
        if (err.code !== "EINVAL" && err.code !== "ENOTSUP" && err.code !== "EBADF") {
          // Log but don't fail the write for unexpected errors
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`Directory fsync failed for ${dir}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    // Clean up temp file on any error
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // Ignore close errors
      }
    }

    // Best-effort cleanup of temp file
    try {
      await fs.unlink(tmp);
    } catch {
      // Ignore unlink errors (file may not exist)
    }

    throw new DocumentWriteError(filePath, { cause: err });
  }
}

/**
 * Read a document from a file
 * @param filePath - File path to read
 * @returns File contents as UTF-8 string
 * @throws DocumentNotFoundError if file doesn't exist
 * @throws DocumentReadError for other read failures
 */
export async function readDocument(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new DocumentNotFoundError(filePath, { cause: err });
    }
    throw new DocumentReadError(filePath, { cause: err });
  }
}

/**
 * Remove a document file (idempotent - no error if file doesn't exist)
 * @param filePath - File path to remove
 * @throws DocumentRemoveError if removal fails for reasons other than file not found
 */
export async function removeDocument(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err: any) {
    // Idempotent: no error if file doesn't exist
    if (err.code === "ENOENT") {
      return;
    }

    // Surface error if trying to remove a directory
    if (err.code === "EISDIR") {
      throw new DocumentRemoveError(filePath, { cause: err });
    }

    throw new DocumentRemoveError(filePath, { cause: err });
  }
}

/**
 * List files in a directory, optionally filtering by extension
 * @param dirPath - Directory path to list
 * @param extension - Optional file extension to filter by (e.g., ".json")
 * @returns Sorted array of filenames (not full paths)
 */
export async function listFiles(dirPath: string, extension?: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Filter to files only, exclude symlinks
    let files = entries
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => entry.name);

    // Filter by extension if provided
    if (extension) {
      // Normalize extension to have leading dot
      const ext = extension.startsWith(".") ? extension : `.${extension}`;
      files = files.filter((name) => name.endsWith(ext));
    }

    // Return sorted list for determinism
    return files.sort();
  } catch (err: any) {
    // Return empty array if directory doesn't exist (simplifies callers)
    if (err.code === "ENOENT") {
      return [];
    }

    throw new ListFilesError(dirPath, { cause: err });
  }
}

/**
 * Transaction for atomic multi-file writes (Layout 1: subfolder-per-object)
 *
 * Provides atomic directory-level operations by staging changes in a temporary
 * directory and committing them with a single atomic rename.
 *
 * Pattern:
 * 1. Create staging directory adjacent to target
 * 2. Write all files to staging directory
 * 3. Commit: atomic rename of staging → target
 * 4. Abort: remove staging directory
 *
 * Invariants:
 * - All writes go to staging directory first
 * - Commit is atomic (single directory rename)
 * - Abort is idempotent and safe to call multiple times
 * - Staging directory is always on same filesystem as target
 */
export class DirTransaction {
  #rootDir: string;
  #stagingDir: string;
  #committed = false;
  #aborted = false;
  #preCommitValidation?: () => Promise<void>;

  /**
   * Create a new directory transaction
   * @param rootDir - Target root directory for the transaction
   * @param options - Optional configuration
   */
  constructor(rootDir: string, options?: { preCommitValidation?: () => Promise<void> }) {
    this.#rootDir = rootDir;
    this.#stagingDir = join(dirname(rootDir), `.txn.${randomUUID()}`);
    this.#preCommitValidation = options?.preCommitValidation;
  }

  /**
   * Get the staging directory path (for internal use)
   */
  get stagingPath(): string {
    return this.#stagingDir;
  }

  /**
   * Get the target directory path
   */
  get targetPath(): string {
    return this.#rootDir;
  }

  /**
   * Write a JSON file to the staging directory
   * @param relPath - Relative path within the directory
   * @param data - Data to serialize as JSON
   */
  async writeJson(relPath: string, data: unknown): Promise<void> {
    this.#checkNotFinalized();
    const targetPath = join(this.#stagingDir, relPath);
    const content = JSON.stringify(data, null, 2) + "\n";
    await atomicWrite(targetPath, content);
  }

  /**
   * Write a file to the staging directory
   * @param relPath - Relative path within the directory
   * @param content - Content to write (string or Buffer)
   */
  async writeFile(relPath: string, content: string | Buffer): Promise<void> {
    this.#checkNotFinalized();
    const targetPath = join(this.#stagingDir, relPath);
    const contentStr = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
    await atomicWrite(targetPath, contentStr);
  }

  /**
   * Copy an entire directory tree into the staging directory
   * @param sourceDir - Source directory to copy from
   * @param targetRelPath - Relative path within staging directory for the copy
   */
  async copyTree(sourceDir: string, targetRelPath: string = ""): Promise<void> {
    this.#checkNotFinalized();

    const targetDir = targetRelPath ? join(this.#stagingDir, targetRelPath) : this.#stagingDir;

    await ensureDirectory(targetDir);

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = join(sourceDir, entry.name);
      const destPath = join(targetDir, entry.name);

      if (entry.isDirectory()) {
        // Recursively copy directories
        const relSubPath = targetRelPath ? join(targetRelPath, entry.name) : entry.name;
        await this.copyTree(srcPath, relSubPath);
      } else if (entry.isFile()) {
        // Copy files
        const content = await fs.readFile(srcPath, "utf-8");
        await atomicWrite(destPath, content);
      }
      // Skip symlinks and other special files
    }
  }

  /**
   * Commit the transaction by atomically renaming staging directory to target
   *
   * If target directory exists, it will be replaced atomically (last-writer-wins).
   * On POSIX systems, this is atomic. On Windows, we attempt best-effort atomicity.
   */
  async commit(): Promise<void> {
    this.#checkNotFinalized();

    try {
      // Run pre-commit validation if provided (e.g., re-check symlinks)
      // This reduces TOCTOU window for security checks
      if (this.#preCommitValidation) {
        await this.#preCommitValidation();
      }

      // Check if target exists
      let targetExists = false;
      try {
        await fs.access(this.#rootDir);
        targetExists = true;
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      if (targetExists) {
        // Target exists - need to replace it atomically
        // On both POSIX and Windows, we need to move old out of the way first
        // because rename() won't replace a non-empty directory
        const backup = `${this.#rootDir}.bak.${randomUUID()}`;
        await fs.rename(this.#rootDir, backup);
        try {
          await fs.rename(this.#stagingDir, this.#rootDir);

          // Success - mark as committed before cleanup
          this.#committed = true;

          // Best-effort backup removal (don't fail if this fails)
          try {
            await fs.rm(backup, { recursive: true, force: true });
          } catch (cleanupErr: any) {
            // Log but don't throw - the commit succeeded
            if (process.env.JSONSTORE_DEBUG) {
              console.warn(`Backup cleanup failed for ${backup}:`, cleanupErr.message);
            }
          }
        } catch (err) {
          // Failed to move staging - restore backup
          try {
            await fs.rename(backup, this.#rootDir);
          } catch {
            // Restore failed - target may be in inconsistent state
          }
          throw err;
        }
      } else {
        // Target doesn't exist - simple rename
        await fs.rename(this.#stagingDir, this.#rootDir);
        this.#committed = true;
      }

      // Fsync parent directory for durability
      if (ENABLE_DIR_FSYNC) {
        const parentDir = dirname(this.#rootDir);
        try {
          const dirHandle = await fs.open(parentDir, "r");
          try {
            await dirHandle.sync();
          } finally {
            await dirHandle.close();
          }
        } catch (err: any) {
          // Best-effort - don't fail commit for fsync errors
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`Directory fsync failed for ${parentDir}:`, err.message);
          }
        }
      }
    } catch (err) {
      // Clean up staging on error
      await this.abort();
      throw new DocumentWriteError(this.#rootDir, { cause: err });
    }
  }

  /**
   * Abort the transaction and clean up staging directory
   * Idempotent - safe to call multiple times
   */
  async abort(): Promise<void> {
    if (this.#aborted || this.#committed) {
      return;
    }

    this.#aborted = true;

    try {
      await fs.rm(this.#stagingDir, { recursive: true, force: true });
    } catch (err: any) {
      // Best-effort cleanup - don't throw on failure
      if (process.env.JSONSTORE_DEBUG) {
        console.warn(`Failed to clean up staging dir ${this.#stagingDir}:`, err.message);
      }
    }
  }

  /**
   * Check if transaction has been finalized (committed or aborted)
   */
  #checkNotFinalized(): void {
    if (this.#committed) {
      throw new Error("Transaction already committed");
    }
    if (this.#aborted) {
      throw new Error("Transaction already aborted");
    }
  }
}
