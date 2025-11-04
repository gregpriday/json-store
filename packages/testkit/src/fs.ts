/**
 * File system test utilities
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "@jsonstore/sdk";
import type { Store, StoreOptions } from "@jsonstore/sdk";

/**
 * Create a unique temporary directory for testing
 * @param prefix - Prefix for the temp directory (default: "jsonstore-test-")
 * @returns Absolute path to temp directory
 */
export async function createTempStoreRoot(prefix = "jsonstore-test-"): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

/**
 * Remove a directory recursively
 * @param path - Path to remove
 */
export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * Execute a function with a temporary store, cleaning up after
 * @param fn - Function to execute with store
 * @param options - Optional store options (root will be overridden)
 * @returns Result of fn
 */
export async function withTempStore<T>(
  fn: (store: Store, root: string) => Promise<T>,
  options?: Partial<StoreOptions>
): Promise<T> {
  const root = await createTempStoreRoot();
  let store: Store;
  try {
    store = openStore({ ...options, root });
  } catch (err) {
    await removeDir(root).catch(() => {});
    throw err;
  }

  let fnError: unknown;
  try {
    return await fn(store, root);
  } catch (err) {
    fnError = err;
    throw err;
  } finally {
    let cleanupError: unknown;
    try {
      await store.close();
    } catch (err) {
      cleanupError = err;
    }
    try {
      await removeDir(root);
    } catch (err) {
      if (!cleanupError) {
        cleanupError = err;
      }
    }
    if (!fnError && cleanupError) {
      // eslint-disable-next-line no-unsafe-finally
      throw cleanupError;
    }
  }
}

/**
 * Execute a function with a clean temp directory
 * @param fn - Function to execute with temp directory path
 * @returns Result of fn
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await createTempStoreRoot();
  try {
    return await fn(dir);
  } finally {
    await removeDir(dir);
  }
}
