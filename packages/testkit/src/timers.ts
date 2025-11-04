/**
 * Timing utilities for performance testing
 */

import { performance } from "node:perf_hooks";

/**
 * High-resolution clock using performance.now()
 * Provides microsecond precision for deterministic benchmarks
 */
export const clock = {
  /**
   * Get current time in milliseconds (high resolution)
   */
  now(): number {
    return performance.now();
  },

  /**
   * Measure execution time of a function
   * @param fn - Function to measure
   * @returns Tuple of [result, duration in ms]
   */
  async measure<T>(fn: () => Promise<T>): Promise<[T, number]> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return [result, duration];
  },

  /**
   * Measure execution time and return only duration
   * @param fn - Function to measure
   * @returns Duration in milliseconds
   */
  async measureDuration<T>(fn: () => Promise<T>): Promise<number> {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  },
};

/**
 * Wait for a specified duration
 * @param ms - Milliseconds to wait
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run garbage collection if available
 * Note: Requires --expose-gc flag
 */
export function runGC(): void {
  if (global.gc) {
    global.gc();
  }
}
