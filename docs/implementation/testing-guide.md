# Testing Guide for JSON Store

This guide provides standards and patterns for testing all JSON Store components.

## Testing Philosophy

- **AAA Pattern**: Arrange, Act, Assert
- **Isolation**: Each test should be independent
- **Coverage**: Aim for >90% on SDK, >80% on CLI/Server
- **Fast**: Unit tests should run in <1s total
- **Deterministic**: No flaky tests

## Test Structure

### File Organization

```
packages/sdk/
├── src/
│   ├── format.ts
│   ├── format.test.ts          # Unit tests alongside code
│   └── format.integration.test.ts  # Integration tests
└── test/
    └── e2e.test.ts              # End-to-end tests
```

## Unit Testing with Vitest

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { myFunction } from './myFunction.js';

describe('myFunction', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  it('should handle basic case', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

### Mocking File System Operations

**Use `vi.mock` with async factory for partial mocking:**

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { readDocument } from './io.js';

// Mock the fs module
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
  };
});

const mockedReadFile = vi.mocked(fs.readFile);
const mockedStat = vi.mocked(fs.stat);

describe('readDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read and return file content', async () => {
    // Arrange
    const mockContent = '{"type":"task","id":"1"}';
    mockedReadFile.mockResolvedValue(mockContent);

    // Act
    const result = readDocument('/path/to/file.json');

    // Assert
    await expect(result).resolves.toBe(mockContent);
    expect(mockedReadFile).toHaveBeenCalledWith('/path/to/file.json', 'utf-8');
  });

  it('should reject when file does not exist', async () => {
    // Arrange
    const error = new Error('ENOENT: no such file or directory');
    mockedReadFile.mockRejectedValue(error);

    // Act & Assert
    await expect(readDocument('/missing.json')).rejects.toThrow('ENOENT');
  });
});
```

### Testing Async Operations

**Use `expect.resolves` and `expect.rejects`:**

```typescript
describe('async operations', () => {
  it('should resolve with data', async () => {
    await expect(asyncFunction()).resolves.toBe('data');
  });

  it('should reject with error', async () => {
    await expect(asyncFunction()).rejects.toThrow('Error message');
  });
});
```

### Anti-Patterns to Avoid

| ❌ Wrong | ✅ Correct | Reason |
|----------|-----------|---------|
| `mockReturnValue(promise)` | `mockResolvedValue(data)` | Async functions return promises |
| `expect(await fn()).toBe()` | `await expect(fn()).resolves.toBe()` | Better error messages |
| Mocking entire module | Partial mock with `importActual` | Preserves non-mocked functions |
| No `vi.clearAllMocks()` | Clear in `beforeEach` | Prevents test interdependence |

## Integration Testing

### Test Real File System with Temp Directory

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.js';

describe('Store Integration', () => {
  let testDir: string;
  let store: Store;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'jsonstore-test-'));
    store = openStore({ root: testDir });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should persist document to disk', async () => {
    await store.put(
      { type: 'task', id: '1' },
      { type: 'task', id: '1', title: 'Test' }
    );

    // Verify file exists
    const filePath = join(testDir, 'task', '1.json');
    const content = await readFile(filePath, 'utf-8');
    expect(JSON.parse(content).title).toBe('Test');
  });
});
```

## CLI Testing

### Test CLI Commands

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

describe('CLI', () => {
  it('should execute put command', async () => {
    const { stdout } = await execAsync(
      `node dist/cli.js put task 1 --data '{"type":"task","id":"1","title":"Test"}'`
    );
    expect(stdout).toContain('Stored task/1');
  });

  it('should exit with code 2 for not found', async () => {
    try {
      await execAsync('node dist/cli.js get task missing');
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error.code).toBe(2);
    }
  });
});
```

## MCP Server Testing

### Test Tool Handlers

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('MCP Server Tools', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    // Register tools...
  });

  it('should handle get_doc tool call', async () => {
    const result = await server.handleToolCall({
      name: 'get_doc',
      arguments: { type: 'task', id: '1' }
    });

    expect(result.structuredContent.doc).toBeDefined();
  });
});
```

## Performance Testing

### Benchmark Tests

```typescript
import { describe, it, expect } from 'vitest';

describe('Performance Benchmarks', () => {
  it('should query 1000 docs in <150ms (cold)', async () => {
    // Setup 1000 documents
    for (let i = 0; i < 1000; i++) {
      await store.put(
        { type: 'task', id: `task-${i}` },
        { type: 'task', id: `task-${i}`, status: 'open' }
      );
    }

    // Benchmark
    const start = Date.now();
    await store.query({
      type: 'task',
      filter: { status: { $eq: 'open' } }
    });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(150);
  });
});
```

## Test Coverage

### Running Coverage

```bash
# Run tests with coverage
pnpm test --coverage

# Generate HTML report
pnpm test --coverage --reporter=html
```

### Coverage Targets

- **SDK**: >90% line coverage
- **CLI**: >80% line coverage
- **Server**: >85% line coverage

## Common Test Scenarios

### Testing Error Handling

```typescript
it('should throw on invalid input', () => {
  expect(() => validateKey({ type: '', id: 'test' }))
    .toThrow('type must be a non-empty string');
});

it('should handle async errors', async () => {
  await expect(store.get({ type: '../bad', id: 'test' }))
    .rejects.toThrow('Path component cannot contain');
});
```

### Testing Cache Behavior

```typescript
it('should cache document on first read', async () => {
  const doc = await store.get({ type: 'task', id: '1' });

  // Second read should come from cache (no fs.readFile call)
  mockedReadFile.mockClear();
  const cached = await store.get({ type: 'task', id: '1' });

  expect(cached).toEqual(doc);
  expect(mockedReadFile).not.toHaveBeenCalled();
});

it('should invalidate cache on write', async () => {
  await store.get({ type: 'task', id: '1' });

  // Update document
  await store.put(
    { type: 'task', id: '1' },
    { type: 'task', id: '1', title: 'Updated' }
  );

  // Next read should hit disk
  mockedReadFile.mockClear();
  await store.get({ type: 'task', id: '1' });
  expect(mockedReadFile).toHaveBeenCalled();
});
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run specific test file
pnpm test format.test.ts

# Run with coverage
pnpm test --coverage

# Run only integration tests
pnpm test integration.test.ts
```

## Continuous Integration

Tests should run on:
- Every commit (pre-commit hook)
- Every pull request
- Before release

Expected CI time: <2 minutes for all tests
