/**
 * Indexes Example
 *
 * Demonstrates creating and using indexes for fast queries.
 * Run with: pnpm tsx examples/with-indexes.ts
 */

import { openStore } from "@jsonstore/sdk";
import { mkdir, rm } from "node:fs/promises";

async function main() {
  // Setup
  const dataDir = "./examples-data/indexes";
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  console.log("📂 Opening store with indexes enabled...\n");
  const store = openStore({
    root: dataDir,
    enableIndexes: true,
    indexes: {
      task: ["status", "priority"],
    },
  });

  // Create sample data
  console.log("✏️  Creating sample data...");
  const statuses = ["open", "in-progress", "blocked", "closed"];
  const priorities = [5, 6, 7, 8, 9, 10];

  for (let i = 1; i <= 100; i++) {
    await store.put(
      { type: "task", id: `task-${i}` },
      {
        type: "task",
        id: `task-${i}`,
        title: `Task ${i}`,
        status: statuses[i % statuses.length],
        priority: priorities[i % priorities.length],
        tags: i % 2 === 0 ? ["even"] : ["odd"],
      }
    );
  }
  console.log(`✅ Created 100 tasks\n`);

  // Query without index (initial)
  console.log("🔍 Querying open tasks (will use index)...");
  const start1 = Date.now();
  const openTasks = await store.query({
    type: "task",
    filter: { status: { $eq: "open" } },
  });
  const duration1 = Date.now() - start1;
  console.log(`✅ Found ${openTasks.length} open tasks in ${duration1}ms`);
  console.log("   (Index was automatically created because we configured it in StoreOptions)\n");

  // Query with index on priority
  console.log("🔍 Querying high-priority tasks (will use index)...");
  const start2 = Date.now();
  const highPriority = await store.query({
    type: "task",
    filter: { priority: { $eq: 10 } },
  });
  const duration2 = Date.now() - start2;
  console.log(`✅ Found ${highPriority.length} priority-10 tasks in ${duration2}ms\n`);

  // Create index on a new field
  console.log("📇 Creating index on tags field...");
  await store.ensureIndex("task", "tags");
  console.log("✅ Index created\n");

  // Query using the new index
  console.log("🔍 Querying even-tagged tasks (will use newly created index)...");
  const start3 = Date.now();
  const evenTasks = await store.query({
    type: "task",
    filter: { tags: { $eq: "even" } },
  });
  const duration3 = Date.now() - start3;
  console.log(`✅ Found ${evenTasks.length} even-tagged tasks in ${duration3}ms\n`);

  // Complex query with indexed field
  console.log("🔍 Complex query with indexed fields...");
  const start4 = Date.now();
  const openWithIndex = await store.query({
    type: "task",
    filter: { status: { $eq: "open" } },
  });
  const complex = openWithIndex.filter(
    (task) => typeof task.priority === "number" && task.priority >= 8
  );
  const duration4 = Date.now() - start4;
  console.log(`✅ Found ${complex.length} tasks in ${duration4}ms`);
  console.log("   (Fetched via status index, then filtered priority in memory)\n");

  // Demonstrate index update on document change
  console.log("✏️  Updating task-1 status from open to closed...");
  const task1 = await store.get({ type: "task", id: "task-1" });
  if (task1) {
    await store.put({ type: "task", id: "task-1" }, { ...task1, status: "closed" });
    console.log("✅ Updated - index automatically maintained\n");

    // Verify index was updated
    console.log("🔍 Querying open tasks again...");
    const openTasksAfter = await store.query({
      type: "task",
      filter: { status: { $eq: "open" } },
    });
    console.log(`✅ Found ${openTasksAfter.length} open tasks (one less than before)\n`);
  }

  // Show index files
  console.log("📁 Index files created:");
  const { readdir } = await import("node:fs/promises");
  try {
    const indexDir = `${dataDir}/task/_indexes`;
    const indexFiles = await readdir(indexDir);
    for (const file of indexFiles) {
      console.log(`   - ${indexDir}/${file}`);
    }
  } catch (err) {
    console.log("   (No index directory found)");
  }

  console.log("\n💡 Key Takeaways:");
  console.log("   • Indexes dramatically speed up equality queries");
  console.log("   • Configure indexes in StoreOptions or use ensureIndex()");
  console.log("   • Indexes are automatically maintained on put/remove");
  console.log("   • Indexes work best for equality filters ($eq)");
  console.log("   • Range queries ($gt, $gte, etc.) still require full scan");

  console.log("\n✅ Indexes example completed!");
  console.log(`📁 Data stored in: ${dataDir}`);
}

main().catch(console.error);
