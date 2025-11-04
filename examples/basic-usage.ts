/**
 * Basic Usage Example
 *
 * Demonstrates fundamental CRUD operations with JSON Store.
 * Run with: pnpm tsx examples/basic-usage.ts
 */

import { openStore } from "@jsonstore/sdk";
import { mkdir, rm } from "node:fs/promises";

async function main() {
  // Setup: Create temporary data directory
  const dataDir = "./examples-data/basic";
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  // Open store
  console.log("📂 Opening store...");
  const store = openStore({ root: dataDir });

  // CREATE: Store a document
  console.log("\n✏️  Creating document...");
  await store.put(
    { type: "task", id: "task-1" },
    {
      type: "task",
      id: "task-1",
      title: "Learn JSON Store",
      description: "Read documentation and try examples",
      status: "open",
      priority: 8,
      tags: ["learning", "documentation"],
      createdAt: new Date().toISOString(),
    }
  );
  console.log("✅ Created task-1");

  // READ: Get a document
  console.log("\n📖 Reading document...");
  const task = await store.get({ type: "task", id: "task-1" });
  if (task) {
    console.log("✅ Found document:");
    console.log(`   Title: ${task.title}`);
    console.log(`   Status: ${task.status}`);
    console.log(`   Priority: ${task.priority}`);
  }

  // UPDATE: Modify a document
  console.log("\n✏️  Updating document...");
  if (!task) {
    throw new Error("Expected task-1 to exist before update");
  }
  await store.put(
    { type: "task", id: "task-1" },
    {
      ...task,
      status: "in-progress",
      startedAt: new Date().toISOString(),
    }
  );
  console.log("✅ Updated task-1 status to in-progress");

  // CREATE MORE: Add several more documents
  console.log("\n✏️  Creating more documents...");
  await store.put(
    { type: "task", id: "task-2" },
    {
      type: "task",
      id: "task-2",
      title: "Build feature",
      status: "open",
      priority: 9,
      tags: ["feature"],
      createdAt: new Date().toISOString(),
    }
  );

  await store.put(
    { type: "task", id: "task-3" },
    {
      type: "task",
      id: "task-3",
      title: "Fix bug",
      status: "open",
      priority: 7,
      tags: ["bug", "urgent"],
      createdAt: new Date().toISOString(),
    }
  );

  await store.put(
    { type: "task", id: "task-4" },
    {
      type: "task",
      id: "task-4",
      title: "Write tests",
      status: "closed",
      priority: 5,
      tags: ["testing"],
      createdAt: new Date().toISOString(),
    }
  );
  console.log("✅ Created 3 more tasks");

  // LIST: Get all IDs for a type
  console.log("\n📋 Listing all task IDs...");
  const ids = await store.list("task");
  console.log(`✅ Found ${ids.length} tasks: ${ids.join(", ")}`);

  // QUERY: Find open tasks
  console.log("\n🔍 Querying for open tasks...");
  const openTasks = await store.query({
    type: "task",
    filter: { status: { $eq: "open" } },
    sort: { priority: -1 },
  });
  console.log(`✅ Found ${openTasks.length} open tasks:`);
  for (const t of openTasks) {
    console.log(`   - ${t.id}: ${t.title} (priority: ${t.priority})`);
  }

  // QUERY: Find high-priority tasks
  console.log("\n🔍 Querying for high-priority tasks (>=8)...");
  const highPriority = await store.query({
    type: "task",
    filter: { priority: { $gte: 8 } },
    sort: { priority: -1 },
  });
  console.log(`✅ Found ${highPriority.length} high-priority tasks:`);
  for (const t of highPriority) {
    console.log(`   - ${t.title} (priority: ${t.priority})`);
  }

  // DELETE: Remove a document
  console.log("\n🗑️  Deleting document...");
  await store.remove({ type: "task", id: "task-4" });
  console.log("✅ Deleted task-4");

  // Verify deletion
  const deletedTask = await store.get({ type: "task", id: "task-4" });
  console.log(`✅ Verified deletion: ${deletedTask === null ? "task-4 not found" : "ERROR"}`);

  // Final stats
  console.log("\n📊 Final stats:");
  const finalIds = await store.list("task");
  console.log(`   Total tasks: ${finalIds.length}`);

  console.log("\n✅ Example completed successfully!");
  console.log(`📁 Data stored in: ${dataDir}`);
}

main().catch(console.error);
