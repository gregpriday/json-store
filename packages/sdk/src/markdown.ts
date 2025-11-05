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
import { MarkdownPathError, MarkdownIntegrityError } from "./errors.js";

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

// Windows reserved device names
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Decode URI component safely, returning original on error
 */
function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Decode URI component multiple times to handle double-encoding
 */
function multiDecode(s: string, maxIterations = 2): string {
  let result = s;
  for (let i = 0; i < maxIterations; i++) {
    const decoded = decodeURIComponentSafe(result);
    if (decoded === result) break;
    result = decoded;
  }
  return result;
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
 * - No URL encoding bypasses
 * - No Windows device names
 * - No UNC paths
 * - No alternate data streams
 *
 * @param relPath - Relative path to normalize
 * @param policy - Path validation policy
 * @returns Normalized relative path
 * @throws {MarkdownPathError} if path violates policy
 */
export function normalizeAndValidateRelPath(relPath: string, _policy: PathPolicy): string {
  // Must be a string
  if (typeof relPath !== "string" || relPath.trim().length === 0) {
    throw new MarkdownPathError(relPath, "path must be a non-empty string");
  }

  // Decode any URL encoding (including double-encoding attacks like %252e%252e)
  const decoded = multiDecode(relPath);

  // Must not be absolute (Unix, Windows drive, or UNC)
  if (decoded.startsWith("/") || /^[a-zA-Z]:/.test(decoded) || decoded.startsWith("\\\\")) {
    throw new MarkdownPathError(decoded, "path must be relative, not absolute");
  }

  // Block null bytes and alternate data streams (Windows :$DATA attacks)
  if (decoded.includes("\0") || decoded.includes(":")) {
    throw new MarkdownPathError(decoded, "path contains illegal characters");
  }

  // Normalize to POSIX-style (replace backslashes with forward slashes)
  let posixPath = decoded.replace(/\\+/g, "/").replace(/\/+/g, "/");

  // Remove leading "./" if present (it's just "current directory" notation)
  if (posixPath.startsWith("./")) {
    posixPath = posixPath.slice(2);
  }

  // Must end with .md (case-insensitive)
  if (!posixPath.toLowerCase().endsWith(".md")) {
    throw new MarkdownPathError(posixPath, "path must end with .md extension");
  }

  // Split into segments
  const segments = posixPath.split("/").filter((s) => s.length > 0);

  // Check each segment for security violations
  for (const segment of segments) {
    // Check for traversal attempts (.. or .)
    if (segment === ".." || segment === ".") {
      throw new MarkdownPathError(posixPath, "path must not contain '..' or '.' segments");
    }

    // Windows: block device names and handle trailing dots/spaces
    const trimmed = segment.replace(/\.+$/u, "").replace(/\s+$/u, "");
    if (trimmed.length === 0) {
      throw new MarkdownPathError(posixPath, "path contains empty segments");
    }

    // Check for Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const basename = trimmed.split(".")[0]; // Get name before extension
    if (WINDOWS_DEVICE_RE.test(basename)) {
      throw new MarkdownPathError(posixPath, "path contains reserved device name");
    }
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
  policy: PathPolicy
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
    throw new MarkdownPathError(normalized, `resolved path ${absPath} is outside allowed roots`);
  }

  return {
    absPath,
    relPath: normalized,
  };
}

/**
 * Check if a path or any of its parent directories are symlinks or hardlinks
 *
 * @param absPath - Absolute path to check
 * @param policy - Path validation policy
 * @throws {MarkdownPathError} if path or any parent is a symlink/hardlink and not allowed
 */
export async function checkSymlink(absPath: string, policy: PathPolicy): Promise<void> {
  if (policy.allowSymlinks) {
    return;
  }

  // Check all path components from root to target
  // This prevents escapes through symlinked directories
  // Use platform-appropriate separator (fixes Windows/UNC path handling)
  const { sep } = await import("node:path");
  const pathParts = absPath.split(sep).filter((p) => p.length > 0);

  // Handle absolute paths correctly per platform
  let currentPath = absPath.startsWith(sep) ? sep : "";
  // Windows drive letter handling (C:\)
  if (process.platform === "win32" && /^[A-Za-z]:/.test(pathParts[0])) {
    currentPath = pathParts.shift()! + sep;
  }

  for (const part of pathParts) {
    currentPath = currentPath ? join(currentPath, part) : part;

    // Only check paths within allowed roots
    let withinRoot = false;
    for (const root of policy.allowedRoots) {
      if (currentPath.startsWith(root)) {
        withinRoot = true;
        break;
      }
    }

    if (!withinRoot) {
      continue; // Skip checking system directories above our roots
    }

    try {
      const stats = await lstat(currentPath);

      // Check for symlinks (includes Windows junctions/reparse points)
      if (stats.isSymbolicLink()) {
        throw new MarkdownPathError(currentPath, "symlinks are not allowed");
      }

      // Check for hardlinks (nlink > 1) to prevent escapes via hardlinked files
      if (stats.isFile() && stats.nlink > 1) {
        throw new MarkdownPathError(currentPath, "hardlinks are not allowed");
      }
    } catch (error) {
      if (error instanceof MarkdownPathError) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Path doesn't exist yet - that's okay, we're checking for writes
        continue;
      }
      // lstat failed for other reason - let it bubble up
      throw new MarkdownPathError(currentPath, `failed to check symlink: ${error}`);
    }
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
export async function verifyIntegrity(absPath: string, expectedSha: string): Promise<void> {
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
    throw new MarkdownPathError(cachePath, "cache path must be under .cache/ directory");
  }

  // Normalize and check for traversal
  normalizeAndValidateRelPath(cachePath.replace(/\.html$/, ".md"), { allowedRoots: [docDir] });

  // Verify it's actually under .cache/
  const absPath = join(docDir, cachePath);
  const cacheDir = join(docDir, ".cache");
  const rel = relative(cacheDir, absPath);

  if (rel.startsWith("..")) {
    throw new MarkdownPathError(cachePath, "cache path escapes .cache/ directory");
  }
}
