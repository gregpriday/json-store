# Documentation Style Guide

This guide defines conventions for JSON Store documentation to ensure consistency across all docs.

## Voice and Tone

- **Direct and concise**: Get to the point quickly
- **Active voice**: Use "The store validates documents" not "Documents are validated"
- **Present tense**: Use "The function returns" not "The function will return"
- **Practical examples**: Show real-world use cases, not toy examples

## Code Blocks

### TypeScript Examples

Always use proper type annotations and imports:

```typescript
import { openStore } from '@jsonstore/sdk';

const store = openStore({ root: './data' });
await store.put(
  { type: 'task', id: 'task-1' },
  { type: 'task', id: 'task-1', title: 'Fix bug', status: 'open' }
);
```

### CLI Examples

Show both the command and relevant output:

```bash
$ jsonstore query --type task --data '{"filter": {"status": {"$eq": "open"}}}'
Found 3 matching documents
[
  {
    "type": "task",
    "id": "task-1",
    "title": "Fix login bug",
    "status": "open"
  }
]
```

## Operator Naming

**CRITICAL**: Always use standardized Mango operators with $ prefix:

### Correct Operators

- `$eq` - Equality
- `$ne` - Not equal
- `$in` - In array
- `$nin` - Not in array
- `$gt` - Greater than
- `$gte` - Greater than or equal
- `$lt` - Less than
- `$lte` - Less than or equal
- `$and` - Logical AND
- `$or` - Logical OR
- `$not` - Logical NOT
- `$exists` - Field existence
- `$type` - Type check

### Shorthand Forms

Document that `$eq` can be omitted:

```typescript
// These are equivalent:
{ status: { $eq: 'open' } }
{ status: 'open' }
```

## API Documentation

### Function Signatures

Use TypeScript notation with clear parameter descriptions:

```typescript
/**
 * Store or update a document
 *
 * @param key - Document identifier (type and id)
 * @param doc - Document data (must include matching type and id fields)
 * @param opts - Optional write options (git commit message)
 * @returns Promise that resolves when write completes
 * @throws {ValidationError} If key or document is invalid
 */
async put(key: Key, doc: Document, opts?: WriteOptions): Promise<void>
```

### Method Documentation Structure

1. **Brief description** (one line)
2. **Detailed explanation** (if needed)
3. **Parameters** (with types and constraints)
4. **Return value**
5. **Errors/exceptions**
6. **Example** (always include)

## File Paths and Commands

### Always Use Forward Slashes

Even when showing Windows examples:

```typescript
// Correct
const store = openStore({ root: './data' });

// Incorrect (platform-specific)
const store = openStore({ root: '.\\data' });
```

### Show Relative Paths

Prefer relative paths for examples:

```bash
# Good
cd ./my-project
jsonstore init --dir ./data

# Avoid (user-specific)
cd /Users/john/my-project
```

## Error Handling

Always show proper error handling in examples:

```typescript
try {
  const doc = await store.get({ type: 'task', id: 'task-1' });
  if (!doc) {
    console.log('Document not found');
  }
} catch (err) {
  console.error('Failed to retrieve document:', err.message);
}
```

## Links and References

### Internal Links

Use relative paths:

```markdown
See [Query Guide](./query-guide.md) for details on operators.
```

### Code References

When referencing code, include file path and line number when relevant:

```markdown
The `openStore()` function in `packages/sdk/src/store.ts` creates a new instance.
```

## Terminology

### Consistent Terms

- **Document** (not "record", "entity", "object")
- **Type** (not "collection", "table", "kind")
- **ID** (not "identifier", "key" when referring to the id field)
- **Key** (when referring to the {type, id} pair)
- **Store** (not "database", "repository")
- **Mango query** (when referring to the query language)
- **Filter** (not "where clause", "condition")

### Avoid Jargon

Explain technical terms on first use:

```markdown
JSON Store uses **deterministic formatting** (consistent key ordering and
indentation) to ensure clean Git diffs.
```

## Examples Format

### Minimal Complete Examples

Every example should be runnable with minimal setup:

```typescript
import { openStore } from '@jsonstore/sdk';

// Create store
const store = openStore({ root: './data' });

// Your example code here
await store.put(
  { type: 'task', id: 'task-1' },
  { type: 'task', id: 'task-1', title: 'Example', status: 'open' }
);
```

### Progressive Examples

Build complexity gradually:

```typescript
// Basic query
await store.query({
  type: 'task',
  filter: { status: 'open' }
});

// With sorting
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { priority: -1 }
});

// With pagination
await store.query({
  type: 'task',
  filter: { status: 'open' },
  sort: { priority: -1 },
  limit: 10,
  skip: 0
});
```

## File Structure

### Document Organization

Organize documentation into clear sections:

1. **Overview** - High-level purpose
2. **Prerequisites** - What reader needs to know
3. **Core Concepts** - Essential understanding
4. **Examples** - Practical use cases
5. **Reference** - Detailed specifications
6. **Troubleshooting** - Common issues

### Heading Hierarchy

- Use `#` for document title
- Use `##` for major sections
- Use `###` for subsections
- Use `####` sparingly for sub-subsections

## Formatting Conventions

### Inline Code

Use backticks for:

- Function names: `openStore()`
- Variable names: `storeOptions`
- File names: `store.ts`
- CLI commands: `jsonstore init`
- Field names: `status`, `priority`
- Operators: `$eq`, `$and`

### Bold

Use for:

- **Important terms** on first introduction
- **Warnings** or critical information
- **Keyboard shortcuts**: Press **Ctrl+C**

### Italics

Use sparingly for:

- *Emphasis* within a sentence
- Book or specification titles

## Platform Notes

### Cross-Platform Compatibility

When documenting platform-specific behavior:

```markdown
**Note**: On Windows, use `pnpm` via PowerShell or Git Bash, not CMD.
```

### Node Version Requirements

Always state version requirements:

```markdown
**Requirements**:
- Node.js 18.0.0 or higher
- pnpm 8.0.0 or higher
```

## Validation

Before publishing documentation:

1. ✅ All code examples are tested and run successfully
2. ✅ All operators use correct $ prefix syntax
3. ✅ Internal links are valid
4. ✅ Code blocks specify language (typescript, bash, json)
5. ✅ Examples use correct imports
6. ✅ Terminology is consistent
7. ✅ Each function has an example
