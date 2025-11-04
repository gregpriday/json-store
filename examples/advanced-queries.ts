/**
 * Advanced Queries Example
 *
 * Demonstrates complex Mango queries with multiple operators.
 * Run with: pnpm tsx examples/advanced-queries.ts
 */

import { openStore } from '@jsonstore/sdk';
import { mkdir, rm } from 'node:fs/promises';

async function main() {
  // Setup
  const dataDir = './examples-data/advanced';
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  const store = openStore({ root: dataDir });
  console.log('📂 Setting up sample data...\n');

  // Create sample tasks
  const tasks = [
    {
      type: 'task',
      id: 'task-1',
      title: 'Critical security fix',
      status: 'open',
      priority: 10,
      assignee: { id: 'user-1', name: 'Alice' },
      tags: ['security', 'urgent'],
      dueDate: '2025-01-05T00:00:00Z'
    },
    {
      type: 'task',
      id: 'task-2',
      title: 'Refactor authentication',
      status: 'in-progress',
      priority: 8,
      assignee: { id: 'user-2', name: 'Bob' },
      tags: ['refactor', 'auth'],
      dueDate: '2025-01-10T00:00:00Z'
    },
    {
      type: 'task',
      id: 'task-3',
      title: 'Update documentation',
      status: 'open',
      priority: 5,
      tags: ['docs'],
      dueDate: '2025-01-15T00:00:00Z'
    },
    {
      type: 'task',
      id: 'task-4',
      title: 'Fix login bug',
      status: 'blocked',
      priority: 9,
      assignee: { id: 'user-1', name: 'Alice' },
      tags: ['bug', 'urgent'],
      dueDate: '2025-01-06T00:00:00Z'
    },
    {
      type: 'task',
      id: 'task-5',
      title: 'Add dark mode',
      status: 'closed',
      priority: 6,
      assignee: { id: 'user-3', name: 'Charlie' },
      tags: ['feature', 'ui'],
      completedAt: '2025-01-03T00:00:00Z'
    }
  ];

  for (const task of tasks) {
    await store.put({ type: 'task', id: task.id }, task);
  }
  console.log(`✅ Created ${tasks.length} sample tasks\n`);

  // Example 1: AND operator
  console.log('🔍 Example 1: High-priority open tasks');
  const result1 = await store.query({
    type: 'task',
    filter: {
      $and: [
        { status: { $eq: 'open' } },
        { priority: { $gte: 8 } }
      ]
    },
    sort: { priority: -1 }
  });
  console.log(`   Found ${result1.length} tasks:`);
  for (const t of result1) {
    console.log(`   - ${t.title} (priority: ${t.priority})`);
  }
  console.log();

  // Example 2: OR operator
  console.log('🔍 Example 2: Tasks that are urgent OR high priority');
  const result2 = await store.query({
    type: 'task',
    filter: {
      $or: [
        { tags: 'urgent' },
        { priority: { $gte: 9 } }
      ]
    }
  });
  console.log(`   Found ${result2.length} tasks:`);
  for (const t of result2) {
    const tags = Array.isArray(t.tags) ? t.tags.map(String) : [];
    console.log(`   - ${t.title} (priority: ${t.priority}, tags: ${tags.join(', ')})`);
  }
  console.log();

  // Example 3: IN operator
  console.log('🔍 Example 3: Tasks in specific statuses');
  const result3 = await store.query({
    type: 'task',
    filter: {
      status: { $in: ['open', 'in-progress'] }
    },
    sort: { priority: -1 }
  });
  console.log(`   Found ${result3.length} tasks:`);
  for (const t of result3) {
    console.log(`   - ${t.title} (status: ${t.status})`);
  }
  console.log();

  // Example 4: EXISTS operator
  console.log('🔍 Example 4: Tasks with an assignee');
  const result4 = await store.query({
    type: 'task',
    filter: {
      assignee: { $exists: true }
    }
  });
  console.log(`   Found ${result4.length} tasks:`);
  for (const t of result4) {
    const assignee = typeof t.assignee === 'object' && t.assignee !== null ? (t.assignee as Record<string, unknown>) : undefined;
    const assigneeName = typeof assignee?.name === 'string' ? assignee.name : 'Unknown';
    console.log(`   - ${t.title} (assignee: ${assigneeName})`);
  }
  console.log();

  // Example 5: NOT operator
  console.log('🔍 Example 5: Tasks that are NOT closed');
  const result5 = await store.query({
    type: 'task',
    filter: {
      $not: { status: { $eq: 'closed' } }
    }
  });
  console.log(`   Found ${result5.length} tasks:`);
  for (const t of result5) {
    console.log(`   - ${t.title} (status: ${t.status})`);
  }
  console.log();

  // Example 6: Nested field query
  console.log('🔍 Example 6: Tasks assigned to Alice');
  const result6 = await store.query({
    type: 'task',
    filter: {
      'assignee.id': { $eq: 'user-1' }
    }
  });
  console.log(`   Found ${result6.length} tasks:`);
  for (const t of result6) {
    const assignee = typeof t.assignee === 'object' && t.assignee !== null ? (t.assignee as Record<string, unknown>) : undefined;
    const assigneeName = typeof assignee?.name === 'string' ? assignee.name : 'Unknown';
    console.log(`   - ${t.title} (assignee: ${assigneeName})`);
  }
  console.log();

  // Example 7: Complex combination
  console.log('🔍 Example 7: Complex query - urgent open tasks OR blocked tasks');
  const result7 = await store.query({
    type: 'task',
    filter: {
      $or: [
        {
          $and: [
            { status: { $eq: 'open' } },
            { tags: 'urgent' }
          ]
        },
        { status: { $eq: 'blocked' } }
      ]
    },
    sort: { priority: -1 }
  });
  console.log(`   Found ${result7.length} tasks:`);
  for (const t of result7) {
    console.log(`   - ${t.title} (status: ${t.status}, priority: ${t.priority})`);
  }
  console.log();

  // Example 8: Projection (only specific fields)
  console.log('🔍 Example 8: Task summaries (projection)');
  const result8 = await store.query({
    type: 'task',
    filter: { status: { $ne: 'closed' } },
    projection: { id: 1, title: 1, priority: 1 },
    sort: { priority: -1 }
  });
  console.log(`   Found ${result8.length} tasks:`);
  for (const t of result8) {
    console.log(`   - ${t.id}: ${t.title} (priority: ${t.priority})`);
    console.log(`     Keys: ${Object.keys(t).join(', ')}`); // Show only projected fields
  }
  console.log();

  // Example 9: Pagination
  console.log('🔍 Example 9: Pagination (page 1 of 2)');
  const page1 = await store.query({
    type: 'task',
    filter: {},
    sort: { id: 1 },
    limit: 3,
    skip: 0
  });
  console.log(`   Page 1 (${page1.length} tasks):`);
  for (const t of page1) {
    console.log(`   - ${t.id}: ${t.title}`);
  }

  const page2 = await store.query({
    type: 'task',
    filter: {},
    sort: { id: 1 },
    limit: 3,
    skip: 3
  });
  console.log(`   Page 2 (${page2.length} tasks):`);
  for (const t of page2) {
    console.log(`   - ${t.id}: ${t.title}`);
  }
  console.log();

  // Example 10: Comparison operators
  console.log('🔍 Example 10: Tasks with priority between 7 and 9');
  const result10 = await store.query({
    type: 'task',
    filter: {
      $and: [
        { priority: { $gte: 7 } },
        { priority: { $lte: 9 } }
      ]
    },
    sort: { priority: -1 }
  });
  console.log(`   Found ${result10.length} tasks:`);
  for (const t of result10) {
    console.log(`   - ${t.title} (priority: ${t.priority})`);
  }

  console.log('\n✅ Advanced queries example completed!');
  console.log(`📁 Data stored in: ${dataDir}`);
}

main().catch(console.error);
