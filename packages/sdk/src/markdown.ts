/**
 * Markdown sidecar utilities for JSON Store
 *
 * Provides path resolution, normalization, validation, and integrity checking
 * for markdown files referenced from JSON documents.
 */

import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join, relative, posix } from "node:path";
import type { MarkdownRef } from "./types.js";
import {
  MarkdownPathError,
  MarkdownIntegrityError,
} from "./errors.js";

/**
 * Path policy for markdown file validation
 */
export interface PathPolicy {
  /** Allowed root directories (absolute paths) */
  allowedRoots: string[];
  /** Whether to allow symlinks (default: false) */
  allowSymlinks?: boolean;
}

/**
 * Resolved markdown path information
 */
export interface ResolvedMarkdownPath {
  /** Absolute path to the markdown file */
  absPath: string;
  /** Relative path (POSIX-style, normalized) */
  relPath: string;
}

/**
 * Normalize and validate a relative path for markdown files
 *
 * Enforces:
 * - POSIX-style paths (forward slashes)
 * - No leading slash (must be relative)
 * - No parent directory traversal (..)
 * - No current directory references (.)
 * - Must end with .md extension
 *
 * @param relPath - Relative path to normalize
 * @param policy - Path validation policy
 * @returns Normalized relative path
 * @throws {MarkdownPathError} if path violates policy
 */
export function normalizeAndValidateRelPath(
  relPath: string,
  _policy: PathPolicy,
): string {
  // Must be a string
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new MarkdownPathError(relPath, "path must be a non-empty string");
  }

  // Must not be absolute
  if (relPath.startsWith("/") || /^[a-zA-Z]:/.test(relPath)) {
    throw new MarkdownPathError(relPath, "path must be relative, not absolute");
  }

  // Normalize to POSIX-style
  let posixPath = relPath.split("\\").join("/");

  // Remove leading "./" if present (it's just "current directory" notation)
  if (posixPath.startsWith("./")) {
    posixPath = posixPath.slice(2);
  }

  // Must end with .md
  if (!posixPath.endsWith(".md")) {
    throw new MarkdownPathError(posixPath, "path must end with .md extension");
  }

  // Split into segments
  const segments = posixPath.split("/").filter((s) => s.length > 0);

  // Check for traversal attempts (.. or .)
  if (segments.some((s) => s === ".." || s === ".")) {
    throw new MarkdownPathError(
      posixPath,
      "path must not contain '..' or '.' segments",
    );
  }

  // Rebuild normalized path
  const normalized = segments.join("/");

  return normalized;
}

/**
 * Resolve a markdown reference to absolute and relative paths
 *
 * @param docDir - Absolute path to the document's directory
 * @param ref - Markdown reference (string or object)
 * @param policy - Path validation policy
 * @returns Resolved path information
 * @throws {MarkdownPathError} if path is invalid
 */
export function resolveMdPath(
  docDir: string,
  ref: MarkdownRef,
  policy: PathPolicy,
): ResolvedMarkdownPath {
  // Extract path from ref
  const relPath = typeof ref === "string" ? ref : ref.path;

  // Normalize and validate
  const normalized = normalizeAndValidateRelPath(relPath, policy);

  // Resolve to absolute path
  const absPath = join(docDir, normalized);

  // Check that resolved path is within allowed roots
  let withinAllowedRoot = false;
  for (const root of policy.allowedRoots) {
    const rel = relative(root, absPath);
    if (!rel.startsWith("..") && !posix.isAbsolute(rel)) {
      withinAllowedRoot = true;
      break;
    }
  }

  if (!withinAllowedRoot) {
    throw new MarkdownPathError(
      normalized,
      `resolved path ${absPath} is outside allowed roots`,
    );
  }

  return {
    absPath,
    relPath: normalized,
  };
}

/**
 * Check if a path is a symlink and reject it if symlinks are not allowed
 *
 * @param absPath - Absolute path to check
 * @param policy - Path validation policy
 * @throws {MarkdownPathError} if path is a symlink and symlinks are not allowed
 */
export async function checkSymlink(
  absPath: string,
  policy: PathPolicy,
): Promise<void> {
  if (policy.allowSymlinks) {
    return;
  }

  try {
    const stats = await lstat(absPath);
    if (stats.isSymbolicLink()) {
      throw new MarkdownPathError(absPath, "symlinks are not allowed");
    }
  } catch (error) {
    if (
      error instanceof MarkdownPathError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw error;
    }
    // lstat failed for other reason - let it bubble up
    throw new MarkdownPathError(absPath, `failed to check symlink: ${error}`);
  }
}

/**
 * Compute SHA-256 hash of a file
 *
 * @param absPath - Absolute path to the file
 * @returns Hex-encoded SHA-256 hash
 */
export async function computeSha256(absPath: string): Promise<string> {
  const content = await readFile(absPath);
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/**
 * Verify file integrity against expected SHA-256 hash
 *
 * @param absPath - Absolute path to the file
 * @param expectedSha - Expected SHA-256 hash (hex-encoded)
 * @throws {MarkdownIntegrityError} if hash doesn't match
 */
export async function verifyIntegrity(
  absPath: string,
  expectedSha: string,
): Promise<void> {
  const actualSha = await computeSha256(absPath);
  if (actualSha !== expectedSha) {
    throw new MarkdownIntegrityError(absPath, expectedSha, actualSha);
  }
}

/**
 * Generate cache path for rendered HTML
 *
 * For Layout 1 (subfolder-per-object), cache files go in `.cache/<key>.html`
 * next to the document directory.
 *
 * @param docDir - Absolute path to the document's directory
 * @param key - Markdown field key
 * @returns Absolute path to cache file
 */
export function renderCachePathForKey(docDir: string, key: string): string {
  const cacheDir = join(docDir, ".cache");
  return join(cacheDir, `${key}.html`);
}

/**
 * Validate a cache path to ensure it's under .cache/ and doesn't escape
 *
 * @param cachePath - Relative cache path from the document directory
 * @param docDir - Absolute path to the document's directory
 * @throws {MarkdownPathError} if cache path is invalid
 */
export function validateCachePath(cachePath: string, docDir: string): void {
  // Must start with .cache/
  if (!cachePath.startsWith(".cache/")) {
    throw new MarkdownPathError(
      cachePath,
      "cache path must be under .cache/ directory",
    );
  }

  // Normalize and check for traversal
  normalizeAndValidateRelPath(
    cachePath.replace(/\.html$/, ".md"),
    { allowedRoots: [docDir] },
  );

  // Verify it's actually under .cache/
  const absPath = join(docDir, cachePath);
  const cacheDir = join(docDir, ".cache");
  const rel = relative(cacheDir, absPath);

  if (rel.startsWith("..")) {
    throw new MarkdownPathError(
      cachePath,
      "cache path escapes .cache/ directory",
    );
  }
}
