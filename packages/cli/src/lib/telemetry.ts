/**
 * Telemetry and observability helpers
 */

import { isVerbose } from "./env.js";
import { writeStderr } from "./io.js";

const SANITIZE_NEWLINES = /[\r\n]+/g;

/**
 * Sanitize metric part by removing newlines
 */
function sanitizeMetricPart(part: unknown): string {
  return String(part).replace(SANITIZE_NEWLINES, " ").trim();
}

/**
 * Emit a metric to stderr if verbose mode is enabled
 */
export function emitMetric(key: string, fields: Record<string, unknown>): void {
  if (!isVerbose()) {
    return;
  }

  const parts = [`metric ${sanitizeMetricPart(key)}`];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`${sanitizeMetricPart(k)}=${sanitizeMetricPart(v)}`);
  }

  writeStderr(parts.join(" ") + "\n");
}

/**
 * Wrap an async function with timing metrics
 */
export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let success = false;

  try {
    const result = await fn();
    success = true;
    return result;
  } finally {
    const duration = Date.now() - start;
    emitMetric(label, {
      duration_ms: duration,
      success,
    });
  }
}
