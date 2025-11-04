# Mango Query Language Guide

Complete guide to querying documents in JSON Store using the Mango query language.

## Overview

JSON Store uses a MongoDB-style query language called Mango for filtering, sorting, and projecting documents. Queries are expressed as JSON objects and support complex conditions with logical operators.

## Table of Contents

- [Basic Queries](#basic-queries)
- [Equality Operators](#equality-operators)
- [Comparison Operators](#comparison-operators)
- [Array Operators](#array-operators)
- [Logical Operators](#logical-operators)
- [Existence Operators](#existence-operators)
- [Sorting](#sorting)
- [Projection](#projection)
- [Pagination](#pagination)
- [Nested Fields](#nested-fields)
- [Real-World Examples](#real-world-examples)

## Basic Queries

The simplest query filters documents by exact field values.

### Equality (Implicit $eq)

```typescript
// Find tasks with status 'open'
await store.query({
  type: 'task',
  filter: { status: 'open' }
});

// Equivalent explicit form
await store.query({
  type: 'task',
  filter: { status: { $eq: 'open' } }
});
```

## Equality Operators

### $eq (Equals)

Matches documents where the field equals the specified value.

```typescript
// Find tasks with priority exactly 8
await store.query({
  type: 'task',
  filter: { priority: { $eq: 8 } }
});

// String equality
await store.query({
  type: 'user',
  filter: { email: { $eq: 'alice@example.com' } }
});
```

**Type Semantics:**
- Strict equality check (`===`)
- `null` matches only `null`
- `undefined` matches only `undefined` or missing fields

### $ne (Not Equals)

Matches documents where the field does not equal the specified value.

```typescript
// Find tasks that are not closed
await store.query({
  type: 'task',
  filter: { status: { $ne: 'closed' } }
});

// Exclude specific priority
await store.query({
  type: 'task',
  filter: { priority: { $ne: 0 } }
});
```

**Behavior:**
- Matches documents where field is missing
- Matches documents where field has different value

### $in (In Array)

Matches documents where the field value is in the specified array.

```typescript
// Find tasks with specific statuses
await store.query({
  type: 'task',
  filter: {
    status: { $in: ['open', 'ready', 'in-progress'] }
  }
});

// Multiple priorities
await store.query({
  type: 'task',
  filter: {
    priority: { $in: [8, 9, 10] }
  }
});
```

**Behavior:**
- Returns match if field value equals any array element
- Uses strict equality for each comparison
- Empty array `[]` matches no documents

### $nin (Not In Array)

Matches documents where the field value is not in the specified array.

```typescript
// Find tasks excluding certain statuses
await store.query({
  type: 'task',
  filter: {
    status: { $nin: ['closed', 'cancelled'] }
  }
});
```

**Behavior:**
- Matches documents where field is missing
- Matches documents where field value is not in array

## Comparison Operators

### $gt (Greater Than)

Matches documents where the field value is greater than the specified value.

```typescript
// Find high-priority tasks
await store.query({
  type: 'task',
  filter: {
    priority: { $gt: 7 }
  }
});

// Date comparison
await store.query({
  type: 'task',
  filter: {
    createdAt: { $gt: '2025-01-01T00:00:00Z' }
  }
});
```

**Type Comparison:**
- Numbers: Numeric comparison
- Strings: Lexicographic comparison
- Dates (ISO strings): Lexicographic comparison works correctly
- Mixed types: No match

### $gte (Greater Than or Equal)

Matches documents where the field value is greater than or equal to the specified value.

```typescript
// Find tasks with priority 8 or higher
await store.query({
  type: 'task',
  filter: {
    priority: { $gte: 8 }
  }
});
```

### $lt (Less Than)

Matches documents where the field value is less than the specified value.

```typescript
// Find low-priority tasks
await store.query({
  type: 'task',
  filter: {
    priority: { $lt: 5 }
  }
});
```

### $lte (Less Than or Equal)

Matches documents where the field value is less than or equal to the specified value.

```typescript
// Find tasks with priority 3 or lower
await store.query({
  type: 'task',
  filter: {
    priority: { $lte: 3 }
  }
});
```

## Array Operators

When querying array fields, operators match if any array element satisfies the condition.

```typescript
// Find tasks with 'urgent' tag
await store.query({
  type: 'task',
  filter: {
    tags: { $eq: 'urgent' }  // Matches if 'urgent' is in tags array
  }
});

// Find tasks with specific tags
await store.query({
  type: 'task',
  filter: {
    $or: [
      { tags: { $eq: 'bug' } },
      { tags: { $eq: 'urgent' } }
    ]
  }
});

// Note: $in compares the field value directly against each candidate.
// To test whether an array field contains one of several values,
// combine $eq with $or as shown above.
```

## Logical Operators

### $and (Logical AND)

Matches documents that satisfy all conditions.

```typescript
// Find open high-priority tasks
await store.query({
  type: 'task',
  filter: {
    $and: [
      { status: { $eq: 'open' } },
      { priority: { $gte: 8 } }
    ]
  }
});

// Multiple conditions
await store.query({
  type: 'task',
  filter: {
    $and: [
      { status: { $in: ['open', 'ready'] } },
      { priority: { $gte: 5 } },
      { assignee: { $exists: true } }
    ]
  }
});
```

**Implicit AND:**

Top-level fields are implicitly ANDed:

```typescript
// These are equivalent
{ status: 'open', priority: 8 }
{ $and: [{ status: 'open' }, { priority: 8 }] }
```

### $or (Logical OR)

Matches documents that satisfy at least one condition.

```typescript
// Find tasks that are urgent OR high priority
await store.query({
  type: 'task',
  filter: {
    $or: [
      { tags: 'urgent' },
      { priority: { $gte: 8 } }
    ]
  }
});

// Complex OR
await store.query({
  type: 'task',
  filter: {
    $or: [
      { status: 'blocked' },
      {
        $and: [
          { status: 'open' },
          { priority: { $gte: 9 } }
        ]
      }
    ]
  }
});
```

### $not (Logical NOT)

Matches documents that do not satisfy the condition.

```typescript
// Find tasks that are NOT open
await store.query({
  type: 'task',
  filter: {
    $not: { status: { $eq: 'open' } }
  }
});

// Negate complex condition
await store.query({
  type: 'task',
  filter: {
    $not: {
      $and: [
        { status: 'closed' },
        { priority: { $lt: 5 } }
      ]
    }
  }
});
```

## Existence Operators

### $exists (Field Existence)

Matches documents where the field exists (or doesn't exist).

```typescript
// Find tasks with an assignee
await store.query({
  type: 'task',
  filter: {
    assignee: { $exists: true }
  }
});

// Find tasks without an assignee
await store.query({
  type: 'task',
  filter: {
    assignee: { $exists: false }
  }
});
```

**Behavior:**
- `$exists: true` matches documents where field is present (including `null` values)
- `$exists: false` matches documents where field is absent or `undefined`

### $type (Type Check)

Matches documents where the field has the specified JavaScript type.

```typescript
// Find documents where priority is a number
await store.query({
  type: 'task',
  filter: {
    priority: { $type: 'number' }
  }
});

// Find documents where tags is an array
await store.query({
  type: 'task',
  filter: {
    tags: { $type: 'array' }
  }
});
```

**Supported Types:**
- `'string'`
- `'number'`
- `'boolean'`
- `'array'`
- `'object'` (includes `null` values)
- `'undefined'`

## Sorting

Specify sort order with `1` for ascending and `-1` for descending.

```typescript
// Sort by priority descending
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { priority: -1 }
});

// Multi-field sort
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: {
    priority: -1,     // First by priority descending
    createdAt: -1,    // Then by createdAt descending
    title: 1          // Then by title ascending
  }
});
```

**Sorting Rules:**
- String fields: Lexicographic (dictionary) order
- Number fields: Numeric order
- Mixed types: Undefined order
- Missing fields: Sorted first (treated as `undefined`)
- Stable sort: Documents with equal sort keys maintain original order

## Projection

Control which fields are included in results.

```typescript
// Include only specific fields
await store.query({
  type: 'task',
  filter: { status: 'open' },
  projection: {
    id: 1,
    title: 1,
    priority: 1
  }
});
// Returns: { id: '...', title: '...', priority: 8 }

// Exclude specific fields
await store.query({
  type: 'task',
  filter: { status: 'open' },
  projection: {
    description: 0,
    metadata: 0
  }
});
// Returns all fields except description and metadata
```

**Rules:**
- Cannot mix inclusion and exclusion (except for `_id`)
- `1` means include field
- `0` means exclude field
- Nested field projection supported: `{ 'assignee.name': 1 }`

## Pagination

Use `limit` and `skip` for pagination.

```typescript
// First page (20 items)
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { createdAt: -1 },
  limit: 20,
  skip: 0
});

// Second page
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { createdAt: -1 },
  limit: 20,
  skip: 20
});

// Third page
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { createdAt: -1 },
  limit: 20,
  skip: 40
});
```

**Performance:**
- Without sort: Early termination after limit reached (efficient)
- With sort: Must load all matching documents before pagination (use indexes)

## Nested Fields

Access nested object fields using dot notation.

```typescript
// Query nested fields
await store.query({
  type: 'task',
  filter: {
    'assignee.id': { $eq: 'user-123' }
  }
});

// Deep nesting
await store.query({
  type: 'task',
  filter: {
    'metadata.priority.level': { $gte: 8 }
  }
});

// Sort by nested field
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { 'assignee.name': 1 }
});
```

## Real-World Examples

### Find High-Priority Open Tasks

```typescript
const urgentTasks = await store.query({
  type: 'task',
  filter: {
    $and: [
      { status: { $eq: 'open' } },
      { priority: { $gte: 8 } }
    ]
  },
  sort: { priority: -1, createdAt: -1 },
  limit: 10
});
```

### Find Unassigned Tasks Due This Week

```typescript
const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const unassignedTasks = await store.query({
  type: 'task',
  filter: {
    $and: [
      { assignee: { $exists: false } },
      { dueDate: { $lte: oneWeekFromNow } },
      { status: { $nin: ['closed', 'cancelled'] } }
    ]
  },
  sort: { dueDate: 1 }
});
```

### Find Active Users with Verified Email

```typescript
const activeUsers = await store.query({
  type: 'user',
  filter: {
    $and: [
      { 'email.verified': { $eq: true } },
      { status: { $eq: 'active' } },
      { lastLoginAt: { $exists: true } }
    ]
  },
  sort: { lastLoginAt: -1 }
});
```

### Complex Search with Multiple Criteria

```typescript
const complexQuery = await store.query({
  type: 'task',
  filter: {
    $or: [
      // High priority tasks
      {
        $and: [
          { priority: { $gte: 8 } },
          { status: { $in: ['open', 'ready'] } }
        ]
      },
      // Blocked tasks
      { status: { $eq: 'blocked' } },
      // Overdue tasks
      {
        $and: [
          { dueDate: { $lt: new Date().toISOString() } },
          { status: { $ne: 'closed' } }
        ]
      }
    ]
  },
  projection: {
    id: 1,
    title: 1,
    status: 1,
    priority: 1,
    dueDate: 1,
    assignee: 1
  },
  sort: { priority: -1, dueDate: 1 },
  limit: 50
});
```

### Search Across All Types

```typescript
// Query without type restriction
const allOpenItems = await store.query({
  filter: {
    $and: [
      { status: { $eq: 'open' } },
      { type: { $in: ['task', 'issue', 'bug'] } }
    ]
  },
  sort: { createdAt: -1 }
});
```

### Count Documents Matching Filter

```typescript
const count = (await store.query({
  type: 'task',
  filter: { status: 'open' }
})).length;

console.log(`Found ${count} open tasks`);
```

### Pagination with Stable Ordering

```typescript
async function paginateTasks(page: number, pageSize: number) {
  return await store.query({
    type: 'task',
    filter: { status: 'open' },
    sort: { id: 1 },  // Stable sort by ID
    limit: pageSize,
    skip: page * pageSize
  });
}

const page1 = await paginateTasks(0, 20);
const page2 = await paginateTasks(1, 20);
```

## Query Optimization

### Use Indexes

Enable indexes for frequently queried fields:

```typescript
// Create indexes
await store.ensureIndex('task', 'status');
await store.ensureIndex('task', 'priority');
await store.ensureIndex('user', 'email');

// Queries will automatically use indexes when available
await store.query({
  type: 'task',
  filter: { status: { $eq: 'open' } }  // Uses index
});
```

### Limit Result Sets

Always use `limit` for large result sets:

```typescript
// Good: Limited results
await store.query({
  type: 'task',
  filter: { status: 'open' },
  limit: 100
});

// Avoid: Unbounded results
await store.query({
  type: 'task',
  filter: { status: 'open' }
  // Could return thousands of documents
});
```

### Specific Type Queries

Always specify `type` when possible:

```typescript
// Good: Scans only 'task' documents
await store.query({
  type: 'task',
  filter: { priority: { $gte: 8 } }
});

// Slower: Scans all types
await store.query({
  filter: { priority: { $gte: 8 } }
});
```

## Performance Characteristics

| Query Pattern | Complexity | Notes |
|---------------|------------|-------|
| Equality with index | O(1) | Fast lookup via index |
| Equality without index | O(n) | Full scan required |
| Range operators | O(n) | Full scan required |
| Sorted query | O(n log n) | Must materialize and sort |
| Unsorted query with limit | O(n) | Early termination possible |
| Nested $and/$or | O(n * m) | m = depth of nesting |

**Recommendations:**
- Use indexes for frequently filtered fields
- Specify `type` to limit scan scope
- Use `limit` to avoid loading excessive documents
- Prefer simple equality filters over complex conditions when possible
