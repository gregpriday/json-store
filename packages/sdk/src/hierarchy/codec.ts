/**
 * Codec utilities for hierarchical keys, slugs, and paths
 * Provides normalization, encoding, and sharding functions
 */

import { createHash } from "node:crypto";
import type { Slug, MaterializedPath, Key } from "../types.js";
import { validateSlug, validateMaterializedPath } from "../validation.js";

/**
 * Normalize a string to a valid slug
 * Converts to lowercase, NFC normalized, ASCII-hyphen format
 * @param input - Input string to normalize
 * @returns Normalized slug
 */
export function normalizeSlug(input: string): Slug {
  // Normalize Unicode to NFC form
  let normalized = input.normalize("NFC");

  // Convert to lowercase
  normalized = normalized.toLowerCase();

  // Replace whitespace and underscores with hyphens
  normalized = normalized.replace(/[\s_]+/g, "-");

  // Remove any characters that aren't alphanumeric or hyphen
  normalized = normalized.replace(/[^a-z0-9-]/g, "");

  // Replace multiple consecutive hyphens with single hyphen
  normalized = normalized.replace(/-+/g, "-");

  // Trim hyphens from start and end
  normalized = normalized.replace(/^-+|-+$/g, "");

  // Validate the result
  return validateSlug(normalized);
}

/**
 * Encode a materialized path from path segments
 * @param segments - Path segments (slugs)
 * @returns Encoded materialized path
 */
export function encodePath(segments: string[]): MaterializedPath {
  if (segments.length === 0) {
    return "/" as MaterializedPath;
  }

  // Validate each segment is a valid slug
  const validatedSegments = segments.map((seg) => validateSlug(seg));

  // Build path with leading slash
  const path = "/" + validatedSegments.join("/");

  return validateMaterializedPath(path);
}

/**
 * Decode a materialized path into segments
 * @param path - Materialized path
 * @returns Array of slug segments
 */
export function decodePath(path: MaterializedPath): Slug[] {
  if (path === "/") {
    return [];
  }

  // Remove leading slash and split
  const segments = path.slice(1).split("/");

  // Each segment is already a validated slug since path was validated
  return segments as Slug[];
}

/**
 * Compute shard key for distributing index entries across buckets
 * Uses consistent hashing to avoid hot files
 * @param key - Key to shard
 * @param fanout - Number of buckets (default: 256)
 * @returns Shard bucket name and suffix
 */
export function shardKey(key: string, fanout: number = 256): { bucket: string; suffix: string } {
  // Hash the key to get consistent distribution
  const hash = createHash("sha256").update(key).digest("hex");

  // Take first 2 hex chars (0-255) and mod by fanout
  const bucketNum = parseInt(hash.slice(0, 2), 16) % fanout;

  // Format bucket as zero-padded hex (e.g., "00", "a3", "ff")
  const bucket = bucketNum.toString(16).padStart(2, "0");

  // Suffix is rest of hash for uniqueness within bucket
  const suffix = hash.slice(2, 10);

  return { bucket, suffix };
}

/**
 * Compute sort key for a child document
 * Sort order: type (ascending) → slug (ascending) → id (ascending)
 * @param child - Child key
 * @param slug - Optional slug
 * @returns Sort key string
 */
export function childrenSortKey(child: Key, slug?: Slug): string {
  // Format: type|slug|id
  // Use | as separator (not in valid slugs/types)
  const slugPart = slug ?? "";
  return `${child.type}|${slugPart}|${child.id}`;
}

/**
 * Parse a sort key back into components
 * @param sortKey - Sort key string
 * @returns Parsed components
 */
export function parseSortKey(sortKey: string): { type: string; slug: string; id: string } {
  const parts = sortKey.split("|");
  if (parts.length !== 3) {
    throw new Error(`Invalid sort key format: "${sortKey}"`);
  }

  return {
    type: parts[0]!,
    slug: parts[1]!,
    id: parts[2]!,
  };
}

/**
 * Compute the materialized path for a document given its parent path and slug
 * @param parentPath - Parent's materialized path (or undefined for root)
 * @param slug - Document's slug
 * @returns Computed materialized path
 */
export function computePath(
  parentPath: MaterializedPath | undefined,
  slug: Slug
): MaterializedPath {
  if (!parentPath || parentPath === "/") {
    return `/${slug}` as MaterializedPath;
  }

  return `${parentPath}/${slug}` as MaterializedPath;
}

/**
 * Get parent path from a materialized path
 * @param path - Materialized path
 * @returns Parent path (or undefined if root)
 */
export function getParentPath(path: MaterializedPath): MaterializedPath | undefined {
  if (path === "/") {
    return undefined;
  }

  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === 0) {
    // Parent is root
    return "/" as MaterializedPath;
  }

  return path.slice(0, lastSlash) as MaterializedPath;
}

/**
 * Extract the last segment (slug) from a materialized path
 * @param path - Materialized path
 * @returns Last slug segment
 */
export function getLastSegment(path: MaterializedPath): Slug | undefined {
  if (path === "/") {
    return undefined;
  }

  const segments = decodePath(path);
  return segments[segments.length - 1];
}
