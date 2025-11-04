/**
 * Argument parsing and validation helpers
 */

import { InvalidArgumentError } from "commander";

/**
 * Parse a non-negative integer argument
 */
export function parseNonNegativeInt(value: string, name: string): number {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(`${name} must be a non-negative integer`);
  }

  const parsed = Number.parseInt(trimmed, 10);

  // Enforce reasonable max to prevent runaway queries
  if (parsed > 10000) {
    throw new InvalidArgumentError(`${name} must be <= 10000`);
  }

  return parsed;
}

/**
 * Parse JSON with descriptive error messages
 */
export function parseJson(value: string, source: string): unknown {
  try {
    // Strip BOM if present
    const cleaned = value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
    return JSON.parse(cleaned);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new InvalidArgumentError(`Invalid JSON in ${source}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Validate path is safe (no directory traversal)
 */
export function parsePath(value: string, name: string): string {
  // Basic safety check - sanitizePath from SDK will do full validation
  const segments = value.split(/[\\/]+/).filter(Boolean);

  if (segments.some((segment) => segment === "..")) {
    throw new InvalidArgumentError(
      `${name} cannot contain ".." path segments (directory traversal)`
    );
  }

  return value;
}
