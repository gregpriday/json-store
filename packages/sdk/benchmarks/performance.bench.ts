/**
 * Performance benchmarks for JSON Store
 * Measures performance against SLO targets with deterministic datasets
 *
 * Run with: NODE_OPTIONS=--expose-gc pnpm bench
 */

import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../src/store.js";
import { QUERY_SLO } from "../src/contracts/query.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Benchmark result
 */
interface BenchmarkResult {
  name: string;
  description: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sloMs?: number;
  passedSlo: boolean;
}

/**
 * Benchmark suite results
 */
interface BenchmarkReport {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  results: BenchmarkResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

/**
 * Run GC if available
 */
function runGC(): void {
  if (global.gc) {
    global.gc();
  } else {
    console.warn("GC not available. Run with NODE_OPTIONS=--expose-gc for accurate benchmarks");
  }
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * Run a benchmark multiple times and collect statistics
 */
async function benchmark(
  name: string,
  description: string,
  fn: () => Promise<void>,
  options: { iterations?: number; slo?: number; warmup?: number } = {}
): Promise<BenchmarkResult> {
  const { iterations = 10, slo, warmup = 2 } = options;

  console.log(`\nRunning: ${name}`);
  console.log(`  ${description}`);

  // Warmup runs
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  runGC();

  // Actual benchmark runs
  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const duration = performance.now() - start;
    durations.push(duration);

    process.stdout.write(".");
  }
  process.stdout.write("\n");

  // Calculate statistics
  const sorted = [...durations].sort((a, b) => a - b);
  const total = durations.reduce((sum, d) => sum + d, 0);
  const avg = total / iterations;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  const passedSlo = slo === undefined || p95 <= slo;

  console.log(
    `  Avg: ${avg.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms | Min: ${min.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`
  );
  if (slo !== undefined) {
    console.log(`  SLO: ${slo}ms | ${passedSlo ? "✓ PASS" : "✗ FAIL"}`);
  }

  return {
    name,
    description,
    iterations,
    totalMs: total,
    avgMs: avg,
    minMs: min,
    maxMs: max,
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    sloMs: slo,
    passedSlo,
  };
}

/**
 * Run all benchmarks
 */
async function runBenchmarks(): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];
  let testDir: string;

  console.log("=".repeat(80));
  console.log("JSON Store Performance Benchmarks");
  console.log("=".repeat(80));

  // Cold query benchmark (1000 docs)
  {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-bench-"));
    const store = openStore({ root: testDir });

    // Create deterministic dataset
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: `task-${i}` },
        {
          type: "task",
          id: `task-${i}`,
          status: i % 2 === 0 ? "open" : "closed",
          priority: i % 10,
        }
      );
    }

    await store.close();

    // Cold query: fresh process, no cache
    const result = await benchmark(
      "Cold Query (1000 docs)",
      "Query 1000 documents with no cache or pre-warming",
      async () => {
        runGC();
        const freshStore = openStore({ root: testDir });
        await freshStore.query({
          type: "task",
          filter: { status: { $eq: "open" } },
        });
        await freshStore.close();
      },
      { iterations: 5, slo: QUERY_SLO.COLD_QUERY_1K_MS }
    );
    results.push(result);

    await rm(testDir, { recursive: true, force: true });
  }

  // Warm query benchmark (1000 docs)
  {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-bench-"));
    const store = openStore({ root: testDir });

    // Create dataset
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: `task-${i}` },
        {
          type: "task",
          id: `task-${i}`,
          status: i % 2 === 0 ? "open" : "closed",
          priority: i % 10,
        }
      );
    }

    // Pre-warm with a query
    await store.query({
      type: "task",
      filter: { status: { $eq: "open" } },
    });

    const result = await benchmark(
      "Warm Query (1000 docs)",
      "Query 1000 documents with cache pre-warmed",
      async () => {
        await store.query({
          type: "task",
          filter: { status: { $eq: "open" } },
        });
      },
      { iterations: 20, slo: QUERY_SLO.WARM_QUERY_1K_MS }
    );
    results.push(result);

    await store.close();
    await rm(testDir, { recursive: true, force: true });
  }

  // Indexed equality query benchmark
  {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-bench-"));
    const store = openStore({ root: testDir });

    // Create dataset
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: `task-${i}` },
        {
          type: "task",
          id: `task-${i}`,
          status: i % 5 === 0 ? "closed" : "open",
        }
      );
    }

    // Create index
    await store.ensureIndex("task", "status");

    // Pre-warm
    await store.query({
      type: "task",
      filter: { status: { $eq: "open" } },
    });

    const result = await benchmark(
      "Indexed Equality Query",
      "Equality query on indexed field (1000 docs)",
      async () => {
        await store.query({
          type: "task",
          filter: { status: { $eq: "open" } },
        });
      },
      { iterations: 50, slo: QUERY_SLO.INDEXED_QUERY_MS }
    );
    results.push(result);

    await store.close();
    await rm(testDir, { recursive: true, force: true });
  }

  // Single document write benchmark
  {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-bench-"));
    const store = openStore({ root: testDir });

    let counter = 0;
    const result = await benchmark(
      "Single Document Write",
      "Write a single document to disk",
      async () => {
        counter++;
        await store.put(
          { type: "task", id: `task-${counter}` },
          { type: "task", id: `task-${counter}`, title: `Task ${counter}` }
        );
      },
      { iterations: 100, slo: QUERY_SLO.SINGLE_WRITE_MS, warmup: 5 }
    );
    results.push(result);

    await store.close();
    await rm(testDir, { recursive: true, force: true });
  }

  // Complex query with sort and pagination
  {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-bench-"));
    const store = openStore({ root: testDir });

    // Create dataset with varied data
    for (let i = 1; i <= 1000; i++) {
      await store.put(
        { type: "task", id: `task-${i}` },
        {
          type: "task",
          id: `task-${i}`,
          status: i % 3 === 0 ? "closed" : i % 2 === 0 ? "ready" : "open",
          priority: i % 10,
          title: `Task ${i}`,
        }
      );
    }

    // Pre-warm
    await store.query({
      type: "task",
      filter: {
        $and: [{ status: { $in: ["open", "ready"] } }, { priority: { $gte: 5 } }],
      },
      sort: { priority: -1, title: 1 },
      limit: 20,
    });

    const result = await benchmark(
      "Complex Query with Sort",
      "Query with $and, $in, $gte, sort, and limit",
      async () => {
        await store.query({
          type: "task",
          filter: {
            $and: [{ status: { $in: ["open", "ready"] } }, { priority: { $gte: 5 } }],
          },
          sort: { priority: -1, title: 1 },
          limit: 20,
        });
      },
      { iterations: 20 }
    );
    results.push(result);

    await store.close();
    await rm(testDir, { recursive: true, force: true });
  }

  // Generate report
  const passed = results.filter((r) => r.passedSlo).length;
  const failed = results.filter((r) => !r.passedSlo).length;

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    results,
    summary: {
      total: results.length,
      passed,
      failed,
    },
  };

  return report;
}

/**
 * Main entry point
 */
async function main() {
  const report = await runBenchmarks();

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("Summary");
  console.log("=".repeat(80));
  console.log(
    `Total: ${report.summary.total} | Passed: ${report.summary.passed} | Failed: ${report.summary.failed}`
  );

  if (report.summary.failed > 0) {
    console.log("\n⚠️  Some benchmarks failed to meet SLO targets");
    process.exitCode = 1;
  } else {
    console.log("\n✓ All benchmarks passed SLO targets");
  }

  // Write report to file
  const reportsDir = join(__dirname, "../.reports");
  await mkdir(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, "benchmarks.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);
}

// Run benchmarks
main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
