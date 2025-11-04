/**
 * Deterministic JSON formatting utilities
 */

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
export function stableStringify(
  obj: any,
  indent = 2,
  order: "alpha" | string[] = "alpha"
): string {
  const seen = new WeakSet();

  const sorter = (a: string, b: string): number => {
    if (order === "alpha") {
      return a.localeCompare(b);
    }
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);

    // If both in order array, use their positions
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    // If only a is in order, it comes first
    if (aIndex !== -1) return -1;
    // If only b is in order, it comes first
    if (bIndex !== -1) return 1;
    // Both not in order array, fallback to alphabetical
    return a.localeCompare(b);
  };

  const normalize = (value: any): any => {
    if (value && typeof value === "object") {
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
        const keys = Object.keys(value).sort(sorter);
        const out: Record<string, any> = {};
        for (const k of keys) {
          out[k] = normalize(value[k]);
        }
        return out;
      } finally {
        seen.delete(value);
      }
    }
    return value;
  };

  return JSON.stringify(normalize(obj), null, indent) + "\n";
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
