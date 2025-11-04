/**
 * Integration tests for markdown sidecar support
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openStore } from "./store.js";
import type { Store, Key } from "./types.js";
import { rm, mkdir, readFile, readdir, writeFile, symlink, unlink } from "node:fs/promises";
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

      // Track DirTransaction usage
      const { DirTransaction } = await import("./io.js");
      let commitCalled = false;
      const originalCommit = DirTransaction.prototype.commit;
      DirTransaction.prototype.commit = async function() {
        commitCalled = true;
        return originalCommit.call(this);
      };

      try {
        await store.put(key, doc, { markdown });

        // Verify DirTransaction was actually used
        expect(commitCalled).toBe(true);

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

        // Verify no staging directories remain
        const parentDir = join(testRoot, "city");
        const entries = await readdir(parentDir);
        const txnDirs = entries.filter(e => e.startsWith(".txn."));
        expect(txnDirs).toEqual([]);
      } finally {
        DirTransaction.prototype.commit = originalCommit;
      }
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

    it("should reject Windows-style absolute paths", async () => {
      const key: Key = { type: "test", id: "windows-abs" };
      const doc = {
        type: "test",
        id: "windows-abs",
        md: {
          content: "C:\\\\temp\\\\evil.md",
        },
      };

      await expect(
        store.put(key, doc, { markdown: { content: "hack" } })
      ).rejects.toThrow("absolute");
    });

    it("should normalize and accept Windows-style backslashes in relative paths", async () => {
      const key: Key = { type: "test", id: "windows-backslash" };
      const doc = {
        type: "test",
        id: "windows-backslash",
        md: {
          content: "subdir\\\\note.md",
        },
      };

      await store.put(key, doc, { markdown: { content: "Valid content" } });

      // Should normalize to forward slashes and work
      const content = await store.readMarkdown(key, "content");
      expect(content).toBe("Valid content");
    });

    it("should reject Windows-style parent traversal with backslashes", async () => {
      const key: Key = { type: "test", id: "windows-traversal" };
      const doc = {
        type: "test",
        id: "windows-traversal",
        md: {
          content: "..\\\\..\\\\evil.md",
        },
      };

      await expect(
        store.put(key, doc, { markdown: { content: "hack" } })
      ).rejects.toThrow();
    });

    it("should validate object-form MarkdownRef paths", async () => {
      const key: Key = { type: "test", id: "object-ref" };
      const doc = {
        type: "test",
        id: "object-ref",
        md: {
          content: {
            path: "../../../etc/passwd.md",
          },
        },
      };

      await expect(
        store.put(key, doc, { markdown: { content: "hack" } })
      ).rejects.toThrow();
    });
  });

  describe("Security - Symlink Protection", () => {
    it("should reject reading markdown files that are symlinks", async () => {
      const key: Key = { type: "symlink-test", id: "file-link" };
      const doc = {
        type: "symlink-test",
        id: "file-link",
        md: {
          content: "./content.md",
        },
      };

      // Create document first
      await store.put(key, doc, { markdown: { content: "Original" } });

      // Replace markdown file with symlink to external file
      const externalFile = join(tmpdir(), `external-${Date.now()}.md`);
      await writeFile(externalFile, "External content", "utf-8");

      const mdPath = join(testRoot, "symlink-test", "file-link", "content.md");
      await unlink(mdPath);
      await symlink(externalFile, mdPath);

      // Reading should reject the symlink
      await expect(store.readMarkdown(key, "content")).rejects.toThrow("symlink");

      // Cleanup
      await unlink(externalFile);
    });

    it("should reject reading through symlinked directories", async () => {
      const key: Key = { type: "symlink-test", id: "dir-link" };
      const doc = {
        type: "symlink-test",
        id: "dir-link",
        md: {
          content: "./exfil/secret.md",
        },
      };

      // Create external directory with sensitive file
      const externalDir = join(tmpdir(), `external-dir-${Date.now()}`);
      await mkdir(externalDir, { recursive: true });
      await writeFile(join(externalDir, "secret.md"), "Sensitive data", "utf-8");

      // Create symlinked subdirectory
      const docDir = join(testRoot, "symlink-test", "dir-link");
      await mkdir(docDir, { recursive: true });
      const symlinkPath = join(docDir, "exfil");
      await symlink(externalDir, symlinkPath);

      // Attempt to write document that references path through symlinked dir
      await expect(
        store.put(key, doc, { markdown: { content: "Trying to access" } })
      ).rejects.toThrow();

      // Cleanup
      await rm(externalDir, { recursive: true, force: true });
    });

    it("should reject writing markdown to symlinked files", async () => {
      const key: Key = { type: "symlink-test", id: "write-link" };
      const doc = {
        type: "symlink-test",
        id: "write-link",
        md: {
          content: "./content.md",
        },
      };

      // Create document first
      await store.put(key, doc, { markdown: { content: "Original" } });

      // Replace markdown file with symlink
      const externalFile = join(tmpdir(), `external-write-${Date.now()}.md`);
      await writeFile(externalFile, "External", "utf-8");

      const mdPath = join(testRoot, "symlink-test", "write-link", "content.md");
      await unlink(mdPath);
      await symlink(externalFile, mdPath);

      // Writing should reject the symlink
      await expect(
        store.writeMarkdown(key, "content", "Attempted overwrite")
      ).rejects.toThrow("symlink");

      // Cleanup
      await unlink(externalFile);
    });
  });

  describe("Error Handling", () => {
    it("should throw MarkdownMissingError when referenced file is deleted", async () => {
      const key: Key = { type: "error-test", id: "missing" };
      const doc = {
        type: "error-test",
        id: "missing",
        md: {
          content: "./content.md",
        },
      };

      // Create document
      await store.put(key, doc, { markdown: { content: "Content" } });

      // Delete the markdown file
      const mdPath = join(testRoot, "error-test", "missing", "content.md");
      await unlink(mdPath);

      // Reading should throw MarkdownMissingError
      await expect(store.readMarkdown(key, "content")).rejects.toThrow("not found");
    });

    it("should preserve untouched markdown files during partial update", async () => {
      const key: Key = { type: "partial", id: "update" };
      const doc = {
        type: "partial",
        id: "update",
        md: {
          field1: "./field1.md",
          field2: "./field2.md",
        },
      };

      // Write initial version with two markdown fields
      await store.put(key, doc, {
        markdown: {
          field1: "Field 1 content",
          field2: "Field 2 content",
        },
      });

      // Verify both exist
      expect(await store.readMarkdown(key, "field1")).toBe("Field 1 content");
      expect(await store.readMarkdown(key, "field2")).toBe("Field 2 content");

      // Update only field1
      await store.put(key, doc, {
        markdown: {
          field1: "Updated field 1",
        },
      });

      // Verify field1 is updated
      expect(await store.readMarkdown(key, "field1")).toBe("Updated field 1");

      // Verify field2 still exists with original content
      expect(await store.readMarkdown(key, "field2")).toBe("Field 2 content");
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
          field1: "./field1.md",
          field2: "./field2.md",
        },
      };

      // Use valid paths, but inject failure during commit
      const { DirTransaction } = await import("./io.js");
      const originalCommit = DirTransaction.prototype.commit;
      let callCount = 0;

      // Mock commit to fail on first call
      DirTransaction.prototype.commit = async function() {
        callCount++;
        if (callCount === 1) {
          // Restore original and throw
          DirTransaction.prototype.commit = originalCommit;
          throw new Error("Simulated commit failure");
        }
        return originalCommit.call(this);
      };

      try {
        // This should fail during commit
        await expect(
          store.put(key, doc, {
            markdown: {
              field1: "Content 1",
              field2: "Content 2",
            },
          })
        ).rejects.toThrow();

        // Verify no partial writes - neither JSON nor markdown should exist
        const jsonPath = join(testRoot, "atomic", "test", "test.json");
        await expect(readFile(jsonPath)).rejects.toThrow();

        const mdPath1 = join(testRoot, "atomic", "test", "field1.md");
        await expect(readFile(mdPath1)).rejects.toThrow();

        const mdPath2 = join(testRoot, "atomic", "test", "field2.md");
        await expect(readFile(mdPath2)).rejects.toThrow();

        // Verify no staging or backup directories left behind
        const parentDir = join(testRoot, "atomic");
        const entries = await readdir(parentDir).catch(() => []);
        const txnDirs = entries.filter(e => e.startsWith(".txn.") || e.startsWith("test.bak."));
        expect(txnDirs).toEqual([]);
      } finally {
        // Restore original method
        DirTransaction.prototype.commit = originalCommit;
      }
    });

    it("should rollback and preserve old version on update failure", async () => {
      const key: Key = { type: "atomic", id: "rollback-test" };
      const docV1 = {
        type: "atomic",
        id: "rollback-test",
        title: "Version 1",
        md: {
          content: "./content.md",
        },
      };

      // Write initial version
      await store.put(key, docV1, {
        markdown: { content: "Original content" },
      });

      // Verify v1 exists
      const v1Content = await store.readMarkdown(key, "content");
      expect(v1Content).toBe("Original content");

      // Now try to update but fail during commit
      const docV2 = {
        ...docV1,
        title: "Version 2",
      };

      const { DirTransaction } = await import("./io.js");
      const originalCommit = DirTransaction.prototype.commit;
      let callCount = 0;

      DirTransaction.prototype.commit = async function() {
        callCount++;
        if (callCount === 1) {
          DirTransaction.prototype.commit = originalCommit;
          throw new Error("Update commit failure");
        }
        return originalCommit.call(this);
      };

      try {
        await expect(
          store.put(key, docV2, {
            markdown: { content: "Updated content" },
          })
        ).rejects.toThrow();

        // Verify old version is still intact
        const doc = await store.get(key);
        expect(doc?.title).toBe("Version 1");

        const content = await store.readMarkdown(key, "content");
        expect(content).toBe("Original content");

        // Verify no backup or staging dirs
        const parentDir = join(testRoot, "atomic");
        const entries = await readdir(parentDir);
        const transientDirs = entries.filter(e =>
          e.startsWith(".txn.") || e.includes(".bak.")
        );
        expect(transientDirs).toEqual([]);
      } finally {
        DirTransaction.prototype.commit = originalCommit;
      }
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
