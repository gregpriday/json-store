import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "benchmarks/**/*.bench.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "benchmarks/performance.bench.ts"],
  },
});
