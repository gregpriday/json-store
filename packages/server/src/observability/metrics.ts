/**
 * In-process metrics for monitoring tool performance
 * Tracks call counts, errors, and latency histograms
 */

interface Counter {
  count: number;
}

interface Histogram {
  values: number[];
  sum: number;
  count: number;
}

class MetricsRegistry {
  #counters: Map<string, Counter> = new Map();
  #histograms: Map<string, Histogram> = new Map();

  // Increment a counter
  inc(name: string, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    const counter = this.#counters.get(key) || { count: 0 };
    counter.count++;
    this.#counters.set(key, counter);
  }

  // Observe a value in a histogram
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.makeKey(name, labels);
    const histogram = this.#histograms.get(key) || { values: [], sum: 0, count: 0 };
    histogram.values.push(value);
    histogram.sum += value;
    histogram.count++;

    // Keep only last 1000 values to prevent unbounded memory growth
    if (histogram.values.length > 1000) {
      const removed = histogram.values.shift();
      if (removed !== undefined) {
        histogram.sum -= removed;
      }
      histogram.count = histogram.values.length;
    }

    this.#histograms.set(key, histogram);
  }

  // Get counter value
  getCounter(name: string, labels: Record<string, string> = {}): number {
    const key = this.makeKey(name, labels);
    return this.#counters.get(key)?.count || 0;
  }

  // Get histogram stats (p50, p95, p99)
  getHistogram(
    name: string,
    labels: Record<string, string> = {}
  ): {
    count: number;
    sum: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const key = this.makeKey(name, labels);
    const histogram = this.#histograms.get(key);
    if (!histogram || histogram.values.length === 0) {
      return null;
    }

    const sorted = [...histogram.values].sort((a, b) => a - b);
    const percentile = (p: number) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      count: histogram.count,
      sum: histogram.sum,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
    };
  }

  // Get all metrics (for debugging)
  getAllMetrics(): {
    counters: Record<string, number>;
    histograms: Record<string, any>;
  } {
    const counters: Record<string, number> = {};
    for (const [key, counter] of this.#counters) {
      counters[key] = counter.count;
    }

    const histograms: Record<string, any> = {};
    for (const [key] of this.#histograms) {
      histograms[key] = this.getHistogram(key.split("{")[0], this.parseLabels(key));
    }

    return { counters, histograms };
  }

  private makeKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  private parseLabels(key: string): Record<string, string> {
    const match = key.match(/\{(.+)\}/);
    if (!match) return {};

    const labels: Record<string, string> = {};
    for (const pair of match[1].split(",")) {
      const [k, v] = pair.split("=");
      labels[k] = v.replace(/"/g, "");
    }
    return labels;
  }
}

export const metrics = new MetricsRegistry();

// Helper to record tool execution metrics
export function recordToolExecution(
  tool: string,
  duration_ms: number,
  success: boolean,
  errCode?: string
): void {
  // Increment call counter
  metrics.inc("jsonstore.tool.calls_total", { tool });

  // Increment error counter if failed
  if (!success) {
    metrics.inc("jsonstore.tool.errors_total", { tool, err_code: errCode || "UNKNOWN" });
  }

  // Record latency
  metrics.observe("jsonstore.tool.latency_ms", duration_ms, { tool });
}
