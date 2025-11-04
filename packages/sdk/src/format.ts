/**
 * Deterministic JSON formatting utilities
 */

import { canonicalize } from "./format/canonical.js";
import type { CanonicalOptions } from "./types.js";

export interface FormatOptions {
  indent?: number;
  order?: "alpha" | string[];
}

/**
 * Stable, deterministic JSON stringification with guaranteed key ordering
 * @param obj - Object to stringify
 * @param indent - Number of spaces for indentation (default: 2)
 * @param order - Key ordering: "alpha" or explicit array (default: "alpha")
 * @returns Formatted JSON string with trailing newline
 */
export function stableStringify(obj: any, indent = 2, order: "alpha" | string[] = "alpha"): string {
  const options: CanonicalOptions = {
    indent,
    stableKeyOrder: order === "alpha" ? true : order,
    eol: "LF",
    trailingNewline: true,
  };
  return canonicalize(obj, options);
}

/**
 * Parse and re-format JSON to canonical form
 * @param json - JSON string to normalize
 * @param options - Formatting options
 * @returns Canonically formatted JSON string
 */
export function normalizeJSON(json: string, options: FormatOptions = {}): string {
  const obj = JSON.parse(json);
  return stableStringify(obj, options.indent ?? 2, options.order ?? "alpha");
}

/**
 * Check if two JSON strings are semantically equivalent (ignoring formatting)
 * @param a - First JSON string
 * @param b - Second JSON string
 * @returns true if semantically equal
 */
export function jsonEqual(a: string, b: string): boolean {
  try {
    const objA = JSON.parse(a);
    const objB = JSON.parse(b);
    // Use stable stringify to ensure consistent comparison
    const normalA = stableStringify(objA, 0, "alpha").trim();
    const normalB = stableStringify(objB, 0, "alpha").trim();
    return normalA === normalB;
  } catch {
    return false;
  }
}
