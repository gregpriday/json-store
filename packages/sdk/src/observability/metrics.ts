/**
 * Metrics tracking for index operations
 */

export interface IndexMetrics {
  hitCount: number;
  missCount: number;
  queryTimeMs: number[];
  readTimeMs: number[];
  writeTimeMs: number[];
  rebuildTimeMs: number[];
  keys: number;
  sizeBytes: number;
}

class MetricsCollector {
  #metrics = new Map<string, IndexMetrics>();

  /**
   * Get or create metrics for an index
   */
  #getMetrics(type: string, field: string): IndexMetrics {
    const key = `${type}/${field}`;
    let metrics = this.#metrics.get(key);
    if (!metrics) {
      metrics = {
        hitCount: 0,
        missCount: 0,
        queryTimeMs: [],
        readTimeMs: [],
        writeTimeMs: [],
        rebuildTimeMs: [],
        keys: 0,
        sizeBytes: 0,
      };
      this.#metrics.set(key, metrics);
    }
    return metrics;
  }

  /**
   * Record index hit
   */
  recordHit(type: string, field: string): void {
    const metrics = this.#getMetrics(type, field);
    metrics.hitCount++;
  }

  /**
   * Record index miss
   */
  recordMiss(type: string, field: string): void {
    const metrics = this.#getMetrics(type, field);
    metrics.missCount++;
  }

  /**
   * Record query time
   */
  recordQueryTime(type: string, field: string, ms: number): void {
    const metrics = this.#getMetrics(type, field);
    metrics.queryTimeMs.push(ms);

    // Keep only last 100 samples to avoid unbounded memory growth
    if (metrics.queryTimeMs.length > 100) {
      metrics.queryTimeMs.shift();
    }
  }

  /**
   * Record read time
   */
  recordReadTime(type: string, field: string, ms: number): void {
    const metrics = this.#getMetrics(type, field);
    metrics.readTimeMs.push(ms);

    if (metrics.readTimeMs.length > 100) {
      metrics.readTimeMs.shift();
    }
  }

  /**
   * Record write time
   */
  recordWriteTime(type: string, field: string, ms: number): void {
    const metrics = this.#getMetrics(type, field);
    metrics.writeTimeMs.push(ms);

    if (metrics.writeTimeMs.length > 100) {
      metrics.writeTimeMs.shift();
    }
  }

  /**
   * Record rebuild time
   */
  recordRebuildTime(type: string, field: string, ms: number): void {
    const metrics = this.#getMetrics(type, field);
    metrics.rebuildTimeMs.push(ms);

    if (metrics.rebuildTimeMs.length > 100) {
      metrics.rebuildTimeMs.shift();
    }
  }

  /**
   * Update index size metrics
   */
  updateSize(type: string, field: string, keys: number, bytes: number): void {
    const metrics = this.#getMetrics(type, field);
    metrics.keys = keys;
    metrics.sizeBytes = bytes;
  }

  /**
   * Get metrics for an index
   */
  getMetrics(type: string, field: string): IndexMetrics | undefined {
    const key = `${type}/${field}`;
    return this.#metrics.get(key);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, IndexMetrics> {
    return new Map(this.#metrics);
  }

  /**
   * Calculate hit rate for an index
   */
  getHitRate(type: string, field: string): number {
    const metrics = this.#getMetrics(type, field);
    const total = metrics.hitCount + metrics.missCount;
    return total > 0 ? metrics.hitCount / total : 0;
  }

  /**
   * Calculate p95 for a metric
   */
  getP95(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, idx)]!;
  }

  /**
   * Get p95 query time
   */
  getP95QueryTime(type: string, field: string): number {
    const metrics = this.#getMetrics(type, field);
    return this.getP95(metrics.queryTimeMs);
  }

  /**
   * Reset metrics for an index
   */
  reset(type?: string, field?: string): void {
    if (type && field) {
      const key = `${type}/${field}`;
      this.#metrics.delete(key);
    } else {
      this.#metrics.clear();
    }
  }
}

/**
 * Global metrics collector instance
 */
export const metrics = new MetricsCollector();
