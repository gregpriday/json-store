import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, readDocument, removeDocument, ensureDirectory, listFiles } from "./io.js";
import {
  DocumentNotFoundError,
  DocumentReadError,
  DocumentWriteError,
  DocumentRemoveError,
  DirectoryError,
  ListFilesError,
} from "./errors.js";

describe("io operations", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory after each test
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("atomicWrite and readDocument", () => {
    it("should write and read file successfully", async () => {
      const filePath = join(testDir, "test.json");
      const content = '{"test": "data"}';

      await atomicWrite(filePath, content);
      const result = await readDocument(filePath);

      expect(result).toBe(content);
    });

    it("should not leave temp files after successful write", async () => {
      const filePath = join(testDir, "test.json");
      const content = '{"test": "data"}';

      await atomicWrite(filePath, content);

      const files = await readdir(testDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));

      expect(tempFiles).toHaveLength(0);
    });

    it("should overwrite existing file atomically", async () => {
      const filePath = join(testDir, "test.json");

      await atomicWrite(filePath, "first");
      await atomicWrite(filePath, "second");

      const result = await readDocument(filePath);
      expect(result).toBe("second");
    });

    it("should handle concurrent writes (last-writer-wins)", async () => {
      const filePath = join(testDir, "concurrent.json");
      const writes = 50;

      // Launch concurrent writes
      const promises = Array.from({ length: writes }, (_, i) =>
        atomicWrite(filePath, `write-${i}`)
      );

      await Promise.all(promises);

      // Final file should contain one of the writes (not partial)
      // Verify it's a complete write from one of the 50 writers
      const result = await readDocument(filePath);
      expect(result).toMatch(/^write-\d+$/);
      const writeNum = parseInt(result.replace("write-", ""));
      expect(writeNum).toBeGreaterThanOrEqual(0);
      expect(writeNum).toBeLessThan(writes);

      // No temp files should remain
      const files = await readdir(testDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });

    it("should handle large content correctly", async () => {
      const filePath = join(testDir, "large.json");
      const largeContent = JSON.stringify({
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          value: `item-${i}`,
        })),
      });

      await atomicWrite(filePath, largeContent);
      const result = await readDocument(filePath);

      expect(result).toBe(largeContent);
    });

    it("should handle empty content correctly", async () => {
      const filePath = join(testDir, "empty.json");

      await atomicWrite(filePath, "");
      const result = await readDocument(filePath);

      expect(result).toBe("");

      // No temp files should remain
      const files = await readdir(testDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });

    it("should handle special characters in filenames", async () => {
      const filePath = join(testDir, "file with spaces & special#chars.json");

      await atomicWrite(filePath, "special chars test");
      const result = await readDocument(filePath);

      expect(result).toBe("special chars test");
    });

    it("should handle unicode in filenames", async () => {
      const filePath = join(testDir, "文件名-🚀-test.json");

      await atomicWrite(filePath, "unicode test");
      const result = await readDocument(filePath);

      expect(result).toBe("unicode test");
    });

    it("should handle deeply nested paths", async () => {
      const deepPath = join(testDir, "level1", "level2", "level3", "level4", "level5", "deep.json");

      await atomicWrite(deepPath, "deep nesting");
      const result = await readDocument(deepPath);

      expect(result).toBe("deep nesting");
    });
  });

  describe("readDocument errors", () => {
    it("should throw DocumentNotFoundError for non-existent file", async () => {
      const filePath = join(testDir, "nonexistent.json");

      await expect(readDocument(filePath)).rejects.toThrow(DocumentNotFoundError);
      await expect(readDocument(filePath)).rejects.toThrow(/Document not found/);
    });

    it("should include file path in error message", async () => {
      const filePath = join(testDir, "missing.json");

      try {
        await readDocument(filePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain(filePath);
        expect(err.code).toBe("ENOENT");
      }
    });

    it("should throw DocumentReadError for non-ENOENT errors (e.g., EISDIR)", async () => {
      const filePath = join(testDir, "is-a-directory");
      await mkdir(filePath);

      try {
        await readDocument(filePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DocumentReadError);
        expect(err.message).toContain(filePath);
        expect(err.cause.code).toBe("EISDIR");
      }
    });
  });

  describe("ensureDirectory", () => {
    it("should create directory if it doesn't exist", async () => {
      const dirPath = join(testDir, "new-dir");

      await ensureDirectory(dirPath);

      // Should be able to write to the directory
      const filePath = join(dirPath, "test.json");
      await atomicWrite(filePath, "test");
      const result = await readDocument(filePath);

      expect(result).toBe("test");
    });

    it("should create nested directories", async () => {
      const dirPath = join(testDir, "level1", "level2", "level3");

      await ensureDirectory(dirPath);

      const filePath = join(dirPath, "test.json");
      await atomicWrite(filePath, "nested");
      const result = await readDocument(filePath);

      expect(result).toBe("nested");
    });

    it("should not error if directory already exists", async () => {
      const dirPath = join(testDir, "existing");

      await ensureDirectory(dirPath);
      await ensureDirectory(dirPath); // Second call should succeed

      // Verify directory exists and is writable
      const testFile = join(dirPath, "test.json");
      await atomicWrite(testFile, "test");
      const result = await readDocument(testFile);
      expect(result).toBe("test");
    });

    it("should validate empty string input", async () => {
      try {
        await ensureDirectory("");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DirectoryError);
        expect(err.cause).toBeInstanceOf(TypeError);
        expect(err.cause.message).toContain("non-empty string");
      }
    });

    it("should validate null/undefined input", async () => {
      try {
        await ensureDirectory(null as any);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DirectoryError);
        expect(err.cause).toBeInstanceOf(TypeError);
      }

      try {
        await ensureDirectory(undefined as any);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DirectoryError);
        expect(err.cause).toBeInstanceOf(TypeError);
      }
    });

    it("should throw DirectoryError when path is a regular file", async () => {
      const filePath = join(testDir, "regular-file.txt");
      await atomicWrite(filePath, "content");

      try {
        await ensureDirectory(filePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DirectoryError);
        expect(err.cause).toBeDefined();
        expect(["EEXIST", "ENOTDIR"]).toContain(err.cause.code);
      }
    });
  });

  describe("atomicWrite with non-existent directory", () => {
    it("should create parent directories automatically", async () => {
      const filePath = join(testDir, "auto", "created", "test.json");

      await atomicWrite(filePath, "auto-created");

      const result = await readDocument(filePath);
      expect(result).toBe("auto-created");
    });
  });

  describe("removeDocument", () => {
    it("should remove existing file", async () => {
      const filePath = join(testDir, "to-remove.json");

      await atomicWrite(filePath, "remove me");
      await removeDocument(filePath);

      await expect(readDocument(filePath)).rejects.toThrow(DocumentNotFoundError);
    });

    it("should be idempotent (no error if file doesn't exist)", async () => {
      const filePath = join(testDir, "never-existed.json");

      // Should not throw and should resolve to undefined
      await expect(removeDocument(filePath)).resolves.toBeUndefined();
      await expect(removeDocument(filePath)).resolves.toBeUndefined();
    });

    it("should throw DocumentRemoveError when trying to remove directory", async () => {
      const dirPath = join(testDir, "is-directory");
      await mkdir(dirPath);

      try {
        await removeDocument(dirPath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DocumentRemoveError);
        expect(err.message).toContain(dirPath);
        // Error code varies by platform (EISDIR on Linux, EPERM on macOS)
        expect(["EISDIR", "EPERM"]).toContain(err.cause.code);
      }
    });

    it("should preserve cause for other filesystem errors", async () => {
      // Skip on Windows - permission tests work differently
      if (process.platform === "win32") {
        return;
      }

      const subdir = join(testDir, "protected");
      await mkdir(subdir);
      const filePath = join(subdir, "locked.json");
      await atomicWrite(filePath, "locked");

      // Make parent directory read-only to prevent file removal
      await chmod(subdir, 0o500);

      try {
        await removeDocument(filePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DocumentRemoveError);
        expect(err.cause).toBeDefined();
        expect(["EACCES", "EPERM"]).toContain(err.cause.code);
      } finally {
        // Restore permissions for cleanup
        await chmod(subdir, 0o755);
      }
    });
  });

  describe("listFiles", () => {
    it("should list all files in directory", async () => {
      await atomicWrite(join(testDir, "file1.json"), "1");
      await atomicWrite(join(testDir, "file2.json"), "2");
      await atomicWrite(join(testDir, "file3.json"), "3");

      const files = await listFiles(testDir);

      expect(files).toEqual(["file1.json", "file2.json", "file3.json"]);
    });

    it("should throw ListFilesError for non-directory paths", async () => {
      const filePath = join(testDir, "regular-file.txt");
      await atomicWrite(filePath, "content");

      try {
        await listFiles(filePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ListFilesError);
        expect(err.message).toContain(filePath);
        expect(err.cause.code).toBe("ENOTDIR");
      }
    });

    it("should return sorted list", async () => {
      await atomicWrite(join(testDir, "zebra.json"), "z");
      await atomicWrite(join(testDir, "apple.json"), "a");
      await atomicWrite(join(testDir, "middle.json"), "m");

      const files = await listFiles(testDir);

      expect(files).toEqual(["apple.json", "middle.json", "zebra.json"]);
    });

    it("should filter by extension", async () => {
      await atomicWrite(join(testDir, "doc1.json"), "1");
      await atomicWrite(join(testDir, "doc2.txt"), "2");
      await atomicWrite(join(testDir, "doc3.json"), "3");

      const jsonFiles = await listFiles(testDir, ".json");

      expect(jsonFiles).toEqual(["doc1.json", "doc3.json"]);
    });

    it("should handle extension without leading dot", async () => {
      await atomicWrite(join(testDir, "doc1.json"), "1");
      await atomicWrite(join(testDir, "doc2.txt"), "2");

      const jsonFiles = await listFiles(testDir, "json");

      expect(jsonFiles).toEqual(["doc1.json"]);
    });

    it("should not include directories in list", async () => {
      await atomicWrite(join(testDir, "file.json"), "1");
      await mkdir(join(testDir, "subdir"));

      const files = await listFiles(testDir);

      expect(files).toEqual(["file.json"]);
    });

    it("should return empty array for non-existent directory", async () => {
      const files = await listFiles(join(testDir, "does-not-exist"));

      expect(files).toEqual([]);
    });

    it("should return filenames only, not full paths", async () => {
      await atomicWrite(join(testDir, "test.json"), "test");

      const files = await listFiles(testDir);

      expect(files).toEqual(["test.json"]);
      expect(files[0]).not.toContain(testDir);
    });
  });

  describe("atomicWrite error handling", () => {
    it("should clean up temp file on write failure", async () => {
      // Create a read-only directory (if permissions allow)
      const readOnlyDir = join(testDir, "readonly");
      await mkdir(readOnlyDir);

      // Skip this test on Windows as chmod doesn't work the same way
      if (process.platform === "win32") {
        return;
      }

      await chmod(readOnlyDir, 0o555); // Read + execute only

      const filePath = join(readOnlyDir, "test.json");

      try {
        await atomicWrite(filePath, "should fail");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(DocumentWriteError);
      }

      // Check no temp files remain
      try {
        const files = await readdir(readOnlyDir);
        const tempFiles = files.filter((f) => f.includes(".tmp"));
        expect(tempFiles).toHaveLength(0);
      } finally {
        // Restore permissions for cleanup
        await chmod(readOnlyDir, 0o755);
      }
    });

    it("should include file path in error", async () => {
      // Skip on Windows
      if (process.platform === "win32") {
        return;
      }

      const readOnlyDir = join(testDir, "readonly2");
      await mkdir(readOnlyDir);
      await chmod(readOnlyDir, 0o555);

      const filePath = join(readOnlyDir, "test.json");

      try {
        await atomicWrite(filePath, "fail");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain(filePath);
      } finally {
        await chmod(readOnlyDir, 0o755);
      }
    });
  });

  describe("error types", () => {
    it("should have correct error codes", async () => {
      const filePath = join(testDir, "missing.json");

      try {
        await readDocument(filePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
        expect(err.name).toBe("DocumentNotFoundError");
      }
    });

    it("should preserve cause in errors", async () => {
      const filePath = join(testDir, "missing.json");

      try {
        await readDocument(filePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.cause).toBeDefined();
        expect(err.cause.code).toBe("ENOENT");
      }
    });
  });

  describe("stress tests", () => {
    it("should handle rapid sequential writes", async () => {
      const filePath = join(testDir, "rapid.json");
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        await atomicWrite(filePath, `iteration-${i}`);
      }

      const result = await readDocument(filePath);
      expect(result).toBe(`iteration-${iterations - 1}`);

      // No temp files
      const files = await readdir(testDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });

    it("should handle concurrent writes to different files", async () => {
      const count = 20;
      const promises = Array.from({ length: count }, (_, i) =>
        atomicWrite(join(testDir, `file-${i}.json`), `content-${i}`)
      );

      await Promise.all(promises);

      // Verify all files exist with correct content
      for (let i = 0; i < count; i++) {
        const content = await readDocument(join(testDir, `file-${i}.json`));
        expect(content).toBe(`content-${i}`);
      }

      // No temp files
      const files = await readdir(testDir);
      const tempFiles = files.filter((f) => f.includes(".tmp"));
      expect(tempFiles).toHaveLength(0);
    });
  });
});

// Performance benchmarks (opt-in with VITEST_PERF=1)
describe.skipIf(!process.env.VITEST_PERF)("performance benchmarks", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-perf-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should write 100 sequential 8KB files with p95 ≤ 15ms", async () => {
    const iterations = 100;
    const content = JSON.stringify({
      data: "x".repeat(8000), // ~8KB payload
    });

    const timings: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const filePath = join(testDir, `perf-${i}.json`);
      const start = performance.now();
      await atomicWrite(filePath, content);
      const duration = performance.now() - start;
      timings.push(duration);
    }

    timings.sort((a, b) => a - b);
    const p95Index = Math.floor(iterations * 0.95);
    const p95 = timings[p95Index];
    const p50 = timings[Math.floor(iterations * 0.5)];

    console.log(`Performance: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

    // SLO: p95 should be ≤ 15ms on local SSD
    expect(p95).toBeLessThanOrEqual(15);
  });
});
