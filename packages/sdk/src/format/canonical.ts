/**
 * Canonical JSON formatting utilities
 *
 * Provides deterministic, byte-stable formatting with:
 * - Stable key ordering (alphabetical or custom)
 * - Consistent EOL normalization (LF or CRLF)
 * - Single trailing newline
 * - UTF-8 encoding without BOM
 *
 * Invariants:
 * - Pure function: same input always produces same output bytes
 * - No mutation of input objects
 * - Cycle detection prevents infinite loops
 */

import type { CanonicalOptions } from "../types.js";

/**
 * Canonicalize a document to stable, deterministic JSON format
 * @param input - Document to canonicalize (any JSON-serializable value)
 * @param options - Canonical formatting options
 * @returns Canonically formatted JSON string
 * @throws Error if circular references detected
 */
export function canonicalize(input: unknown, options: CanonicalOptions): string {
  const seen = new WeakSet<object>();

  /**
   * Deterministic comparison for object keys using Unicode code point order
   */
  const compareKeys = (a: string, b: string): number => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  };

  /**
   * Sort object keys according to the specified ordering strategy
   */
  const sortKeys = (keys: string[]): string[] => {
    if (options.stableKeyOrder === false) {
      return keys; // No sorting
    }

    if (options.stableKeyOrder === true) {
      return keys.slice().sort(compareKeys);
    }

    // Custom key order (array)
    const order = options.stableKeyOrder as string[];
    return keys.slice().sort((a, b) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);

      // Both in order array - use their positions
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // Only a is in order array - it comes first
      if (aIndex !== -1) return -1;
      // Only b is in order array - it comes first
      if (bIndex !== -1) return 1;
      // Neither in order array - alphabetical fallback
      return compareKeys(a, b);
    });
  };

  /**
   * Recursively normalize a value, applying stable key ordering
   */
  const normalize = (value: unknown): unknown => {
    // Null, primitives, functions
    if (value === null || typeof value !== "object") {
      return value;
    }

    // Detect cycles
    if (seen.has(value)) {
      throw new Error("Circular reference detected in object");
    }
    seen.add(value);

    try {
      // Arrays: preserve order but normalize contents
      if (Array.isArray(value)) {
        return value.map(normalize);
      }

      // Objects: sort keys and normalize values
      const keys = sortKeys(Object.keys(value));
      const normalized: Record<string, unknown> = {};
      for (const key of keys) {
        normalized[key] = normalize((value as Record<string, unknown>)[key]);
      }
      return normalized;
    } finally {
      seen.delete(value);
    }
  };

  // Stringify with stable key order
  const json = JSON.stringify(normalize(input), null, options.indent);

  // Normalize EOL
  const eol = options.eol === "CRLF" ? "\r\n" : "\n";
  const withEol = json.replace(/\r\n|\r|\n/g, eol);

  // Ensure single trailing newline
  if (options.trailingNewline) {
    // Remove any trailing whitespace and add exactly one EOL
    return withEol.replace(/\s*$/, "") + eol;
  }

  return withEol;
}

/**
 * Safe JSON parsing with structured error information
 * @param raw - Raw string to parse
 * @returns Parsed object or error details
 */
export function safeParseJson(
  raw: string
): { success: true; data: unknown } | { success: false; error: string } {
  try {
    const data = JSON.parse(raw);
    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
