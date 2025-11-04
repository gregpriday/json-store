/**
 * Integration tests for markdown sidecar support
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openStore } from "./store.js";
import type { Store, Key } from "./types.js";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Markdown Sidecars - Layout 1 (subfolder-per-object)", () => {
  let store: Store;
  let testRoot: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testRoot = join(tmpdir(), `jsonstore-md-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testRoot, { recursive: true });

    store = openStore({
      root: testRoot,
      markdownSidecars: { enabled: true },
    });
  });

  afterEach(async () => {
    await store.close();
    await rm(testRoot, { recursive: true, force: true });
  });

  describe("Basic Write and Read", () => {
    it("should write document with markdown sidecars using DirTransaction", async () => {
      const key: Key = { type: "city", id: "new-york" };
      const doc = {
        type: "city",
        id: "new-york",
        name: "New York City",
        md: {
          summary: "./summary.md",
          history: "./history.md",
        },
      };

      const markdown = {
        summary: "# New York\n\nThe city that never sleeps.",
        history: "## History\n\nFounded in 1624.",
      };

      await store.put(key, doc, { markdown });

      // Verify JSON file exists in subdirectory
      const jsonPath = join(testRoot, "city", "new-york", "new-york.json");
      const jsonContent = await readFile(jsonPath, "utf-8");
      const saved = JSON.parse(jsonContent);
      expect(saved).toEqual(doc);

      // Verify markdown files exist
      const summaryPath = join(testRoot, "city", "new-york", "summary.md");
      const summaryContent = await readFile(summaryPath, "utf-8");
      expect(summaryContent).toBe(markdown.summary);

      const historyPath = join(testRoot, "city", "new-york", "history.md");
      const historyContent = await readFile(historyPath, "utf-8");
      expect(historyContent).toBe(markdown.history);
    });

    it("should read document with markdown content when includeMarkdown is true", async () => {
      const key: Key = { type: "city", id: "paris" };
      const doc = {
        type: "city",
        id: "paris",
        name: "Paris",
        md: {
          summary: "./summary.md",
        },
      };

      const markdown = {
        summary: "# Paris\n\nThe City of Light.",
      };

      await store.put(key, doc, { markdown });

      // Read without markdown
      const docOnly = await store.get(key);
      expect(docOnly).toEqual(doc);
      expect(docOnly).not.toHaveProperty("_markdown");

      // Read with markdown
      const docWithMd = await store.get(key, { includeMarkdown: true });
      expect(docWithMd).toHaveProperty("_markdown");
      expect((docWithMd as any)._markdown.summary).toBe(markdown.summary);
    });

    it("should support Buffer content for markdown", async () => {
      const key: Key = { type: "page", id: "test" };
      const doc = {
        type: "page",
        id: "test",
        md: {
          content: "./content.md",
        },
      };

      const buffer = Buffer.from("# Test\n\nBuffer content", "utf-8");

      await store.put(key, doc, { markdown: { content: buffer } });

      const retrieved = await store.readMarkdown(key, "content");
      expect(retrieved).toBe("# Test\n\nBuffer content");
    });
  });

  describe("readMarkdown and writeMarkdown methods", () => {
    it("should read markdown field using readMarkdown()", async () => {
      const key: Key = { type: "article", id: "test-1" };
      const doc = {
        type: "article",
        id: "test-1",
        title: "Test Article",
        md: {
          body: "./body.md",
        },
      };

      await store.put(key, doc, {
        markdown: {
          body: "## Test Article\n\nThis is the body.",
        },
      });

      const body = await store.readMarkdown(key, "body");
      expect(body).toBe("## Test Article\n\nThis is the body.");
    });

    it("should write markdown field using writeMarkdown()", async () => {
      const key: Key = { type: "article", id: "test-2" };
      const doc = {
        type: "article",
        id: "test-2",
        md: {
          content: "./content.md",
        },
      };

      await store.put(key, doc, {
        markdown: { content: "Initial content" },
      });

      // Update markdown without touching JSON
      await store.writeMarkdown(key, "content", "Updated content");

      const updated = await store.readMarkdown(key, "content");
      expect(updated).toBe("Updated content");

      // Verify JSON wasn't modified
      const docAfter = await store.get(key);
      expect(docAfter).toEqual(doc);
    });

    it("should throw MarkdownMissingError for non-existent field", async () => {
      const key: Key = { type: "article", id: "test-3" };
      const doc = {
        type: "article",
        id: "test-3",
        md: {
          summary: "./summary.md",
        },
      };

      await store.put(key, doc, {
        markdown: { summary: "Summary" },
      });

      await expect(store.readMarkdown(key, "nonexistent")).rejects.toThrow("not referenced");
    });
  });

  describe("Path Validation", () => {
    it("should reject absolute paths", async () => {
      const key: Key = { type: "test", id: "bad-path" };
      const doc = {
        type: "test",
        id: "bad-path",
        md: {
          content: "/etc/passwd",
        },
      };

      await expect(
        store.put(key, doc, { markdown: { content: "hack" } })
      ).rejects.toThrow("absolute");
    });

    it("should reject parent directory traversal", async () => {
      const key: Key = { type: "test", id: "traversal" };
      const doc = {
        type: "test",
        id: "traversal",
        md: {
          content: "../../../etc/passwd",
        },
      };

      await expect(
        store.put(key, doc, { markdown: { content: "hack" } })
      ).rejects.toThrow();
    });

    it("should reject non-.md extensions", async () => {
      const key: Key = { type: "test", id: "wrong-ext" };
      const doc = {
        type: "test",
        id: "wrong-ext",
        md: {
          content: "./content.txt",
        },
      };

      await expect(
        store.put(key, doc, { markdown: { content: "test" } })
      ).rejects.toThrow(".md");
    });
  });

  describe("Extended MarkdownRef with integrity checking", () => {
    it("should support extended ref format with sha256", async () => {
      const key: Key = { type: "doc", id: "secure" };
      const content = "# Secure Document\n\nThis content is verified.";

      // Pre-compute hash
      const crypto = await import("node:crypto");
      const hash = crypto.createHash("sha256");
      hash.update(content);
      const sha256 = hash.digest("hex");

      const doc = {
        type: "doc",
        id: "secure",
        md: {
          content: {
            path: "./content.md",
            sha256,
          },
        },
      };

      await store.put(key, doc, { markdown: { content } });

      // Reading should verify integrity
      const retrieved = await store.readMarkdown(key, "content");
      expect(retrieved).toBe(content);
    });

    it("should throw MarkdownIntegrityError for mismatched hash", async () => {
      const key: Key = { type: "doc", id: "tampered" };
      const doc = {
        type: "doc",
        id: "tampered",
        md: {
          content: {
            path: "./content.md",
            sha256: "0".repeat(64), // Wrong hash
          },
        },
      };

      await store.put(key, doc, { markdown: { content: "Original" } });

      // Reading with wrong hash should fail
      await expect(store.readMarkdown(key, "content")).rejects.toThrow("integrity");
    });
  });

  describe("Feature Flag Behavior", () => {
    it("should not use DirTransaction when markdownSidecars disabled", async () => {
      const storeDisabled = openStore({
        root: testRoot,
        markdownSidecars: { enabled: false },
      });

      const key: Key = { type: "test", id: "disabled" };
      const doc = {
        type: "test",
        id: "disabled",
        md: {
          content: "./content.md",
        },
      };

      // Should write JSON in flat structure (traditional behavior)
      await storeDisabled.put(key, doc, { markdown: { content: "test" } });

      // Verify JSON is in flat structure (not in subfolder)
      const jsonPath = join(testRoot, "test", "disabled.json");
      const jsonContent = await readFile(jsonPath, "utf-8");
      expect(JSON.parse(jsonContent)).toEqual(doc);

      // Markdown file should NOT exist
      const mdPath = join(testRoot, "test", "disabled", "content.md");
      await expect(readFile(mdPath)).rejects.toThrow();

      await storeDisabled.close();
    });
  });

  describe("Atomicity", () => {
    it("should be atomic - all files or none on error", async () => {
      const key: Key = { type: "atomic", id: "test" };
      const doc = {
        type: "atomic",
        id: "test",
        md: {
          valid: "./valid.md",
          invalid: "../invalid.md", // This will cause an error
        },
      };

      // This should fail due to path traversal
      await expect(
        store.put(key, doc, {
          markdown: {
            valid: "Valid content",
            invalid: "Invalid path",
          },
        })
      ).rejects.toThrow();

      // Verify no partial writes - neither JSON nor markdown should exist
      const jsonPath = join(testRoot, "atomic", "test", "test.json");
      await expect(readFile(jsonPath)).rejects.toThrow();

      const mdPath = join(testRoot, "atomic", "test", "valid.md");
      await expect(readFile(mdPath)).rejects.toThrow();
    });
  });

  describe("Update Behavior", () => {
    it("should update both JSON and markdown atomically", async () => {
      const key: Key = { type: "blog", id: "post-1" };
      const docV1 = {
        type: "blog",
        id: "post-1",
        title: "First Post",
        md: {
          content: "./content.md",
        },
      };

      await store.put(key, docV1, {
        markdown: { content: "Version 1" },
      });

      // Update
      const docV2 = {
        ...docV1,
        title: "First Post (Updated)",
      };

      await store.put(key, docV2, {
        markdown: { content: "Version 2" },
      });

      const retrieved = await store.get(key, { includeMarkdown: true });
      expect(retrieved?.title).toBe("First Post (Updated)");
      expect((retrieved as any)._markdown.content).toBe("Version 2");
    });
  });
});
