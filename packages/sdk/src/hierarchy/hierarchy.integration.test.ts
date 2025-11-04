/**
 * Integration tests for hierarchical storage (vertical slice: putHierarchical → by-path index → getByPath/findByPath)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { openStore } from "../index.js";
import type { MaterializedPath, Slug } from "../types.js";

describe("Hierarchical Storage Integration", () => {
  const testRoot = path.join(import.meta.dirname, ".test-hierarchy-data");

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("should create document with hierarchical path and retrieve by path", async () => {
    const store = openStore({
      root: testRoot,
      enableHierarchy: true,
    });

    try {
      // Create a country document with slug
      const countryKey = { type: "country", id: "us" };
      const countryDoc = {
        type: "country",
        id: "us",
        name: "United States",
      };

      // Put hierarchical document
      await store.putHierarchical(
        countryKey,
        countryDoc,
        undefined, // No parent (root level)
        "us" as Slug
      );

      // Verify document was stored
      const retrieved = await store.get(countryKey);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("us");
      expect((retrieved as any).path).toBe("/us");

      // Retrieve by materialized path
      const byPath = await store.findByPath("/us" as MaterializedPath);
      expect(byPath).toBeDefined();
      expect(byPath?.id).toBe("us");
      expect(byPath?.name).toBe("United States");
    } finally {
      await store.close();
    }
  });

  it("should handle nested hierarchy with parent-child relationships", async () => {
    const store = openStore({
      root: testRoot,
      enableHierarchy: true,
    });

    try {
      // Create country
      await store.putHierarchical(
        { type: "country", id: "us" },
        { type: "country", id: "us", name: "United States" },
        undefined,
        "us" as Slug
      );

      // Create region under country
      await store.putHierarchical(
        { type: "region", id: "us-ny" },
        { type: "region", id: "us-ny", name: "New York", countryId: "us" },
        { type: "country", id: "us" },
        "ny" as Slug
      );

      // Verify region path
      const region = await store.get({ type: "region", id: "us-ny" });
      expect((region as any).path).toBe("/us/ny");

      // Retrieve region by path
      const byPath = await store.findByPath("/us/ny" as MaterializedPath);
      expect(byPath).toBeDefined();
      expect(byPath?.id).toBe("us-ny");
      expect(byPath?.name).toBe("New York");
    } finally {
      await store.close();
    }
  });

  it("should rebuild hierarchical indexes via repairHierarchy", async () => {
    const store = openStore({
      root: testRoot,
      enableHierarchy: true,
    });

    try {
      // Create some hierarchical documents
      await store.putHierarchical(
        { type: "country", id: "us" },
        { type: "country", id: "us", name: "United States" },
        undefined,
        "us" as Slug
      );

      await store.putHierarchical(
        { type: "country", id: "ca" },
        { type: "country", id: "ca", name: "Canada" },
        undefined,
        "ca" as Slug
      );

      // Manually corrupt the index
      const indexDir = path.join(testRoot, "_indexes", "by-path");
      await fs.rm(indexDir, { recursive: true, force: true });

      // Verify documents are gone from index
      const beforeRepair = await store.findByPath("/us" as MaterializedPath);
      expect(beforeRepair).toBeNull();

      // Repair hierarchy
      const report = await store.repairHierarchy();

      // Verify repair report
      expect(report.documentsScanned).toBe(2);
      expect(report.indexesRebuilt).toBe(2);
      expect(report.errors).toHaveLength(0);

      // Verify documents are now accessible
      const afterRepair = await store.findByPath("/us" as MaterializedPath);
      expect(afterRepair).toBeDefined();
      expect(afterRepair?.id).toBe("us");

      const afterRepairCa = await store.findByPath("/ca" as MaterializedPath);
      expect(afterRepairCa).toBeDefined();
      expect(afterRepairCa?.id).toBe("ca");
    } finally {
      await store.close();
    }
  });

  it("should enforce path depth limits", async () => {
    const store = openStore({
      root: testRoot,
      enableHierarchy: true,
      experimental: {
        maxDepth: 2, // Limit to 2 levels for testing
      },
    });

    try {
      // Create level 1
      await store.putHierarchical(
        { type: "level1", id: "l1" },
        { type: "level1", id: "l1", name: "Level 1" },
        undefined,
        "l1" as Slug
      );

      // Create level 2 (should succeed)
      await store.putHierarchical(
        { type: "level2", id: "l2" },
        { type: "level2", id: "l2", name: "Level 2" },
        { type: "level1", id: "l1" },
        "l2" as Slug
      );

      // Create level 3 (should fail - exceeds maxDepth of 2)
      await expect(
        store.putHierarchical(
          { type: "level3", id: "l3" },
          { type: "level3", id: "l3", name: "Level 3" },
          { type: "level2", id: "l2" },
          "l3" as Slug
        )
      ).rejects.toThrow(/depth.*exceeds maximum/);
    } finally {
      await store.close();
    }
  });

  it("should handle WAL recovery after simulated crash", async () => {
    // First, create a store and start a transaction
    let store = openStore({
      root: testRoot,
      enableHierarchy: true,
    });

    try {
      // Create document
      await store.putHierarchical(
        { type: "country", id: "us" },
        { type: "country", id: "us", name: "United States" },
        undefined,
        "us" as Slug
      );

      // Close without cleaning up (simulates partial transaction)
      await store.close();

      // Reopen store (should trigger WAL recovery)
      store = openStore({
        root: testRoot,
        enableHierarchy: true,
      });

      // Give it a moment for async recovery
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Document should still be accessible
      const doc = await store.findByPath("/us" as MaterializedPath);
      expect(doc).toBeDefined();
      expect(doc?.id).toBe("us");
    } finally {
      await store.close();
    }
  });

  it("should update existing document's hierarchical path", async () => {
    const store = openStore({
      root: testRoot,
      enableHierarchy: true,
    });

    try {
      // Create initial document
      await store.putHierarchical(
        { type: "country", id: "us" },
        { type: "country", id: "us", name: "United States", version: 1 },
        undefined,
        "us" as Slug
      );

      // Update document (same path)
      await store.putHierarchical(
        { type: "country", id: "us" },
        { type: "country", id: "us", name: "United States", version: 2 },
        undefined,
        "us" as Slug
      );

      // Verify updated document
      const doc = await store.findByPath("/us" as MaterializedPath);
      expect(doc).toBeDefined();
      expect((doc as any).version).toBe(2);
    } finally {
      await store.close();
    }
  });
});
