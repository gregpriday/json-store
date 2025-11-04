import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.js";
import type { Store, Document, Key } from "./types.js";

describe("Store integration tests", () => {
  let testDir: string;
  let store: Store;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "jsonstore-integration-"));
    store = openStore({ root: testDir });
  });

  afterEach(async () => {
    await store.close();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("end-to-end workflows", () => {
    it("should handle complete CRUD workflow", async () => {
      // Initialize - create some documents
      const userKey: Key = { type: "user", id: "alice" };
      const userDoc: Document = {
        type: "user",
        id: "alice",
        name: "Alice Smith",
        email: "alice@example.com",
        age: 30,
      };

      // Create
      await store.put(userKey, userDoc);
      let result = await store.get(userKey);
      expect(result).toEqual(userDoc);

      // Update
      const updatedDoc = { ...userDoc, age: 31 };
      await store.put(userKey, updatedDoc);
      result = await store.get(userKey);
      expect(result).toEqual(updatedDoc);

      // List
      let ids = await store.list("user");
      expect(ids).toEqual(["alice"]);

      // Remove
      await store.remove(userKey);
      result = await store.get(userKey);
      expect(result).toBeNull();

      // List after remove
      ids = await store.list("user");
      expect(ids).toEqual([]);
    });

    it("should handle multiple types in same store", async () => {
      // Create users
      await store.put({ type: "user", id: "alice" }, { type: "user", id: "alice", name: "Alice" });
      await store.put({ type: "user", id: "bob" }, { type: "user", id: "bob", name: "Bob" });

      // Create posts
      await store.put(
        { type: "post", id: "post1" },
        { type: "post", id: "post1", title: "First Post", author: "alice" }
      );
      await store.put(
        { type: "post", id: "post2" },
        { type: "post", id: "post2", title: "Second Post", author: "bob" }
      );

      // Create comments
      await store.put(
        { type: "comment", id: "c1" },
        { type: "comment", id: "c1", text: "Great post!", postId: "post1" }
      );

      // Verify each type has correct documents
      const userIds = await store.list("user");
      expect(userIds).toEqual(["alice", "bob"]);

      const postIds = await store.list("post");
      expect(postIds).toEqual(["post1", "post2"]);

      const commentIds = await store.list("comment");
      expect(commentIds).toEqual(["c1"]);

      // Verify cross-type isolation - check full documents
      const aliceUser = await store.get({ type: "user", id: "alice" });
      expect(aliceUser).toEqual({ type: "user", id: "alice", name: "Alice" });

      const post1 = await store.get({ type: "post", id: "post1" });
      expect(post1).toEqual({ type: "post", id: "post1", title: "First Post", author: "alice" });
    });

    it("should handle concurrent operations on different documents", async () => {
      const operations: Promise<void>[] = [];

      // Create 20 users concurrently
      for (let i = 0; i < 20; i++) {
        operations.push(
          store.put(
            { type: "user", id: `user${i}` },
            { type: "user", id: `user${i}`, name: `User ${i}`, index: i }
          )
        );
      }

      await Promise.all(operations);

      // Verify all were created
      const userIds = await store.list("user");
      expect(userIds).toHaveLength(20);

      // Read all concurrently and verify content
      const reads = userIds.map((id) => store.get({ type: "user", id }));
      const results = await Promise.all(reads);

      expect(results).toHaveLength(20);
      expect(results.every((r) => r !== null)).toBe(true);
      // Verify each document has the correct data (list() returns sorted, so map by ID)
      results.forEach((r) => {
        expect(r?.type).toBe("user");
        const userNum = parseInt(r!.id.replace("user", ""));
        expect((r as any)?.index).toBe(userNum);
        expect((r as any)?.name).toBe(`User ${userNum}`);
      });

      // Update half concurrently
      const updates = userIds
        .slice(0, 10)
        .map((id) =>
          store.put(
            { type: "user", id },
            { type: "user", id, name: `Updated ${id}`, updated: true }
          )
        );
      await Promise.all(updates);

      // Remove half concurrently
      const removes = userIds.slice(10).map((id) => store.remove({ type: "user", id }));
      await Promise.all(removes);

      // Verify final state
      const finalIds = await store.list("user");
      expect(finalIds).toHaveLength(10);

      // All remaining should be updated
      const remaining = await Promise.all(finalIds.map((id) => store.get({ type: "user", id })));
      expect(remaining.every((r) => (r as any)?.updated === true)).toBe(true);
    });

    it("should handle large documents (>100KB)", async () => {
      const key: Key = { type: "data", id: "large" };

      // Create a large document (~150KB)
      const largeArray = Array.from({ length: 5000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: `This is a detailed description for item ${i}`.repeat(3),
        tags: ["tag1", "tag2", "tag3", `tag${i}`],
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          version: 1,
        },
      }));

      const doc: Document = {
        type: "data",
        id: "large",
        items: largeArray,
      };

      // Write large document
      await store.put(key, doc);

      // Read it back
      const result = await store.get(key);
      expect(result).toEqual(doc);

      // Verify items length
      expect((result as any).items).toHaveLength(5000);

      // Update large document
      const updated = { ...doc, version: 2 };
      await store.put(key, updated);

      const result2 = await store.get(key);
      expect((result2 as any).version).toBe(2);
    });

    it("should maintain data integrity across multiple operations", async () => {
      // Scenario: blog platform with users, posts, and comments
      const users = [
        { type: "user", id: "alice", name: "Alice", email: "alice@example.com" },
        { type: "user", id: "bob", name: "Bob", email: "bob@example.com" },
        { type: "user", id: "charlie", name: "Charlie", email: "charlie@example.com" },
      ];

      const posts = [
        { type: "post", id: "p1", title: "Post 1", author: "alice", likes: 10 },
        { type: "post", id: "p2", title: "Post 2", author: "bob", likes: 5 },
        { type: "post", id: "p3", title: "Post 3", author: "alice", likes: 15 },
      ];

      const comments = [
        { type: "comment", id: "c1", postId: "p1", author: "bob", text: "Great!" },
        { type: "comment", id: "c2", postId: "p1", author: "charlie", text: "Thanks!" },
        { type: "comment", id: "c3", postId: "p2", author: "alice", text: "Nice post" },
      ];

      // Create all documents
      for (const user of users) {
        await store.put({ type: "user", id: user.id }, user as Document);
      }
      for (const post of posts) {
        await store.put({ type: "post", id: post.id }, post as Document);
      }
      for (const comment of comments) {
        await store.put({ type: "comment", id: comment.id }, comment as Document);
      }

      // Verify counts
      expect(await store.list("user")).toHaveLength(3);
      expect(await store.list("post")).toHaveLength(3);
      expect(await store.list("comment")).toHaveLength(3);

      // Simulate user deletion cascade
      await store.remove({ type: "user", id: "alice" });

      // User should be gone
      const alice = await store.get({ type: "user", id: "alice" });
      expect(alice).toBeNull();

      // But posts and comments still exist (manual cleanup would be app logic)
      expect(await store.list("post")).toHaveLength(3);
      expect(await store.list("comment")).toHaveLength(3);

      // Update post likes
      const p1 = await store.get({ type: "post", id: "p1" });
      if (p1) {
        await store.put({ type: "post", id: "p1" }, { ...p1, likes: (p1 as any).likes + 1 });
      }

      const updatedP1 = await store.get({ type: "post", id: "p1" });
      expect((updatedP1 as any)?.likes).toBe(11);
    });

    it("should handle rapid create-read-update-delete cycles", async () => {
      const key: Key = { type: "temp", id: "volatile" };

      for (let i = 0; i < 10; i++) {
        // Create
        const doc: Document = { type: "temp", id: "volatile", iteration: i };
        await store.put(key, doc);

        // Read
        const read1 = await store.get(key);
        expect((read1 as any)?.iteration).toBe(i);

        // Update
        const updated = { ...doc, updated: true };
        await store.put(key, updated);

        // Read again
        const read2 = await store.get(key);
        expect((read2 as any)?.updated).toBe(true);

        // Delete
        await store.remove(key);

        // Verify deleted
        const read3 = await store.get(key);
        expect(read3).toBeNull();
      }

      // Should be empty at the end
      const ids = await store.list("temp");
      expect(ids).toEqual([]);
    });

    it("should preserve data types correctly", async () => {
      const key: Key = { type: "test", id: "types" };
      const doc: Document = {
        type: "test",
        id: "types",
        string: "hello",
        number: 42,
        float: 3.14159,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { nested: "value" },
        date: "2024-01-01T00:00:00.000Z",
      };

      await store.put(key, doc);
      const result = await store.get(key);

      expect(result).toEqual(doc);
      expect(typeof (result as any)?.string).toBe("string");
      expect(typeof (result as any)?.number).toBe("number");
      expect(typeof (result as any)?.float).toBe("number");
      expect(typeof (result as any)?.boolean).toBe("boolean");
      expect((result as any)?.null).toBeNull();
      expect(Array.isArray((result as any)?.array)).toBe(true);
      expect(typeof (result as any)?.object).toBe("object");
    });
  });

  describe("cache performance", () => {
    it("should benefit from caching on repeated reads", async () => {
      const key: Key = { type: "user", id: "cached" };
      const doc: Document = { type: "user", id: "cached", name: "Cached User" };

      await store.put(key, doc);

      // Spy on readDocument to verify caching
      const { vi } = await import("vitest");
      const readSpy = vi.spyOn(await import("./io.js"), "readDocument");

      // First read - cache miss (will read from disk)
      await store.get(key);
      const firstReadCount = readSpy.mock.calls.length;

      // Subsequent reads - should be cache hits (no additional disk reads)
      for (let i = 0; i < 10; i++) {
        const result = await store.get(key);
        expect(result).toEqual(doc);
      }

      // Should not have done any additional disk reads
      expect(readSpy.mock.calls.length).toBe(firstReadCount);

      readSpy.mockRestore();
    });

    it("should handle cache invalidation on updates", async () => {
      const key: Key = { type: "user", id: "updated" };

      for (let i = 0; i < 5; i++) {
        const doc: Document = { type: "user", id: "updated", version: i };
        await store.put(key, doc);

        // Read multiple times
        for (let j = 0; j < 3; j++) {
          const result = await store.get(key);
          expect((result as any)?.version).toBe(i);
        }
      }
    });
  });

  describe("stress tests", () => {
    it("should handle many small documents", async () => {
      const count = 100;
      const writes: Promise<void>[] = [];

      // Create 100 documents
      for (let i = 0; i < count; i++) {
        writes.push(
          store.put({ type: "item", id: `item${i}` }, { type: "item", id: `item${i}`, value: i })
        );
      }

      await Promise.all(writes);

      // Verify all exist
      const ids = await store.list("item");
      expect(ids).toHaveLength(count);

      // Read all and verify each document
      const reads = ids.map((id) => store.get({ type: "item", id }));
      const results = await Promise.all(reads);
      expect(results.every((r) => r !== null)).toBe(true);

      // Verify each document has the correct value matching its ID
      results.forEach((doc) => {
        const itemNum = parseInt(doc!.id.replace("item", ""));
        expect((doc as any)?.value).toBe(itemNum);
      });
    });

    it("should handle mixed operations", async () => {
      const operations: Promise<void>[] = [];

      // Mix of creates, reads, updates, deletes
      for (let i = 0; i < 50; i++) {
        const key: Key = { type: "mixed", id: `item${i}` };
        const doc: Document = { type: "mixed", id: `item${i}`, value: i };

        operations.push(
          (async () => {
            await store.put(key, doc);
            await store.get(key);
            if (i % 2 === 0) {
              await store.put(key, { ...doc, updated: true });
            }
            if (i % 3 === 0) {
              await store.remove(key);
            }
          })()
        );
      }

      await Promise.all(operations);

      // Calculate which documents should remain (not deleted by % 3)
      const expectedIds = Array.from({ length: 50 }, (_, i) => `item${i}`)
        .filter((_, i) => i % 3 !== 0)
        .sort();

      const ids = await store.list("mixed");
      expect(ids.sort()).toEqual(expectedIds);
    });
  });
});
