# GitHub Issue Comment Format Guide

**Version:** 1.0.0
**Last Updated:** 2025-11-05
**Purpose:** Standardized format for AI agents providing implementation-focused feedback on JSON Store GitHub issues

---

## Overview

This guide defines the format for composing structured, actionable GitHub issue comments that provide architectural guidance for JSON Store implementation tasks. Comments must prioritize clarity, module boundaries, data flow, interfaces, and concrete implementation steps.

## Core Principles

1. **Architecture-first**: Focus on module boundaries, contracts, and data flow over implementation details
2. **Actionable guidance**: Provide concrete steps, not abstract suggestions
3. **Plain paths, no links**: Reference files/directories as plain text only (e.g., /packages/sdk/src/store.ts)
4. **Code references**: Use inline code for symbols (e.g., `Store.put()`, `ValidationError`)
5. **Risk-aware**: Call out edge cases, performance implications, security concerns
6. **Abort criteria**: Always specify concrete conditions for rollback or abandonment

## File Path Rules (Critical)

### DO ✅

- Use repo-root absolute paths: /packages/sdk/src/store.ts
- End directories with trailing slash: /packages/sdk/src/
- Plain text only: /packages/cli/src/commands/query.ts
- Line references as text: /packages/sdk/src/query.ts lines 120-148

### DON'T ❌

- **Never create Markdown links** for files or directories
- **Never wrap filenames in backticks** (reserved for code symbols only)
- Never use `./` relative paths (use absolute from repo root)
- Never reference external repos or submodules
- Never use branch names or GitHub URLs

### Examples

**Correct:**
```
The Store.put() method in /packages/sdk/src/store.ts calls validateDocument() before writing.
```

**Wrong:**
```
The `Store.put()` method in [`/packages/sdk/src/store.ts`](/packages/sdk/src/store.ts) calls `validateDocument()` before writing.
```

## Required Comment Structure

All comments must follow this exact order:

### 1. Goal
Define pass/fail criteria or acceptance template.

**Format:**
```markdown
## Goal

[2-4 sentences describing what "done" looks like, including:]
- Functional requirement (what works)
- Performance requirement (if applicable: p95 ≤ Xms, throughput ≥ Y ops/sec)
- Integration requirement (which modules must interoperate)
```

**Example:**
```markdown
## Goal

Implement hierarchical query support that allows filtering by materialized path prefix with p95 ≤ 50ms for queries on datasets up to 10,000 documents. The query engine must integrate with existing index infrastructure without breaking backward compatibility. All existing tests must pass, and new tests must cover path-based filtering.
```

### 2. Approach Overview

High-level steps showing the architecture flow.

**Format:**
```markdown
## Approach Overview

1. [Module/file] - [Action/responsibility]
2. [Module/file] - [Action/responsibility]
3-8 steps total, ordered by execution or dependency
```

**Example:**
```markdown
## Approach Overview

1. /packages/sdk/src/types.ts - Add PathSpec and MaterializedPath types
2. /packages/sdk/src/validation.ts - Implement validateMaterializedPath() with NFC normalization
3. /packages/sdk/src/hierarchy/codec.ts - Add encodePath() and decodePath() utilities
4. /packages/sdk/src/query.ts - Extend filter evaluator to handle path prefix matching
5. /packages/sdk/src/indexes.ts - Add path-based secondary index support
6. /packages/sdk/src/store.ts - Wire HierarchyManager into Store.query()
```

### 3. Step-by-Step Plan

Detailed architectural steps with expected outcomes.

**Format:**
```markdown
## Step-by-Step Plan

### Step 1: [Module/Component] - [Change Description]

**Location:** /path/to/file.ts

**Changes:**
- [Specific change 1]
- [Specific change 2]

**Key interfaces:**
- `InterfaceName.method()`: [Purpose and contract]

**Invariants:**
- [Critical constraint 1]
- [Critical constraint 2]

**Expected outcome:** [What should work after this step]

### Step 2: [Next module]
[Continue pattern...]
```

**Guidelines:**
- Number all steps (Step 1, Step 2, etc.)
- Include file paths for every step
- Reference functions/types with inline code: `Store.put()`, `ValidationError`
- Call out invariants and contracts explicitly
- End each step with concrete expected outcome
- Keep code snippets ≤ 20 lines (only when essential for clarity)

**Example:**
```markdown
## Step-by-Step Plan

### Step 1: Type Definitions - Add Hierarchy Types

**Location:** /packages/sdk/src/types.ts

**Changes:**
- Add MaterializedPath branded type (string with __brand property)
- Add PathSpec interface with scope, type, and slugPath fields
- Extend HierarchicalKey with optional path field

**Key interfaces:**
- `validateMaterializedPath(path: string): MaterializedPath`: Validates format (leading /, NFC normalized, segments are slugs)

**Invariants:**
- Paths must start with /
- Path segments separated by / must be valid slugs
- Paths must be Unicode NFC normalized
- Empty path or path with empty segments is invalid

**Expected outcome:** TypeScript compilation succeeds; types are exported from index.ts

### Step 2: Validation Logic - Path Validation

**Location:** /packages/sdk/src/validation.ts

**Changes:**
- Implement validateMaterializedPath() with regex check
- Add Unicode NFC normalization
- Throw ValidationError on invalid format

**Invariants:**
- Validation must reject paths without leading /
- Validation must reject paths with empty segments (e.g., /foo//bar)
- Must normalize to NFC before validation

**Expected outcome:** Unit tests pass for valid/invalid path formats
```

### 4. Tests

Specify test coverage with commands.

**Format:**
```markdown
## Tests

### Unit Tests

**Location:** /path/to/file.test.ts

**Test cases:**
- [Test case 1: description]
- [Test case 2: description]

### Integration Tests

**Location:** /path/to/integration.test.ts

**Test cases:**
- [Integration scenario 1]
- [Integration scenario 2]

### E2E Tests

**Location:** /path/to/e2e.test.ts

**Test cases:**
- [E2E workflow 1]

### Running Tests

```bash
pnpm --filter @jsonstore/sdk test
pnpm --filter @jsonstore/cli test
```

### Performance Tests (if applicable)

**Command:**
```bash
VITEST_PERF=1 pnpm --filter @jsonstore/sdk test
```

**Targets:**
- [Metric 1]: [Target value]
- [Metric 2]: [Target value]
```

**Example:**
```markdown
## Tests

### Unit Tests

**Location:** /packages/sdk/src/validation.test.ts

**Test cases:**
- Valid paths: /foo, /foo/bar, /foo/bar/baz
- Invalid paths: foo, /foo/, /foo//bar, empty string
- Unicode normalization: /café normalizes to NFC
- Slug validation within path segments

### Integration Tests

**Location:** /packages/sdk/src/hierarchy/hierarchy.integration.test.ts

**Test cases:**
- putHierarchical() creates valid materialized paths
- getByPath() resolves documents correctly
- Path index consistency after reparenting

### Running Tests

```bash
pnpm --filter @jsonstore/sdk test validation.test.ts
pnpm --filter @jsonstore/sdk test hierarchy.integration.test.ts
```
```

### 5. Edge Cases & Risks

Identify failure scenarios and mitigations.

**Format:**
```markdown
## Edge Cases & Risks

### Edge Case: [Scenario]
**Risk:** [What can go wrong]
**Mitigation:** [How to prevent/handle]

### Performance Risk: [Scenario]
**Risk:** [Performance degradation scenario]
**Mitigation:** [Optimization strategy]

### Security Risk: [Scenario]
**Risk:** [Security vulnerability]
**Mitigation:** [Security hardening]
```

**Example:**
```markdown
## Edge Cases & Risks

### Edge Case: Circular Parent References
**Risk:** putHierarchical() with parentKey pointing to descendant causes infinite loop
**Mitigation:** Implement cycle detection in HierarchyManager.validateParent() by walking up ancestry; reject if cycle detected

### Performance Risk: Deep Tree Traversal
**Risk:** Path resolution on deeply nested trees (depth > 100) causes stack overflow
**Mitigation:** Enforce maxDepth limit (default 32) in StoreOptions; use iterative traversal instead of recursion

### Security Risk: Path Traversal via Slug Injection
**Risk:** Malicious slug containing ../ could escape hierarchy boundaries
**Mitigation:** validateSlug() rejects slugs with /, .., or other path separators; paths are constructed programmatically, never from user strings

### Data Consistency Risk: Index Corruption During Reparent
**Risk:** Concurrent reparenting operations corrupt children indexes
**Mitigation:** Use fine-grained locks per parent ID in LockManager; WAL-based transactions for multi-index updates
```

### 6. Rollout & Monitoring

Deployment strategy with abort criteria.

**Format:**
```markdown
## Rollout & Monitoring

### Feature Flags
- [Flag name]: [Purpose and default value]

### Telemetry
- **Logs:** [What to log, where to find logs]
- **Metrics:** [What to measure, where to track metrics]

### Rollback Plan
**Trigger conditions:**
- [Abort criterion 1]
- [Abort criterion 2]

**Rollback procedure:**
1. [Step 1 to revert]
2. [Step 2 to revert]

### Abort Criteria
- [Specific failure condition that requires stopping deployment]
- [Performance threshold that triggers abort]
```

**Example:**
```markdown
## Rollout & Monitoring

### Feature Flags
- enableHierarchy: Enable hierarchical storage (default: false)
- experimental.maxDepth: Maximum tree depth (default: 32, range: 1-128)

### Telemetry
- **Logs:** Structured logs in /packages/sdk/src/observability/logs.ts
  - hierarchy.put event with parentKey, path, duration
  - hierarchy.error event with operation, error code, context
- **Metrics:** Performance metrics in /packages/sdk/src/observability/metrics.ts
  - hierarchy.put.duration_ms (p50, p95, p99)
  - hierarchy.path_lookup.duration_ms (p50, p95)
  - hierarchy.index_size_bytes (per type)

### Rollback Plan
**Trigger conditions:**
- p95 hierarchy.put.duration_ms > 100ms for 5 consecutive minutes
- Error rate > 1% on hierarchy operations
- Index corruption detected in consistency checks

**Rollback procedure:**
1. Set enableHierarchy flag to false in store config
2. Restart MCP server to clear in-memory state
3. Run repairHierarchy() to rebuild indexes from primary documents
4. Verify tests pass with hierarchy disabled

### Abort Criteria
- More than 3 index corruption errors in production logs within 1 hour
- p99 query latency exceeds 500ms (5x regression from baseline)
- Memory usage grows unbounded (indicates leak in HierarchyManager)
```

### 7. Acceptance Checklist

Concrete completion criteria.

**Format:**
```markdown
## Acceptance Checklist

- [ ] All unit tests pass (≥ 95% coverage)
- [ ] Integration tests pass for [specific scenarios]
- [ ] E2E tests cover [specific workflows]
- [ ] Performance SLO met: [metric] ≤ [threshold]
- [ ] Documentation updated: [specific files]
- [ ] Observability: Logs available at [location], metrics tracked in [location]
- [ ] Security review complete (if applicable)
- [ ] Breaking changes documented (if applicable)
```

**Example:**
```markdown
## Acceptance Checklist

- [ ] All unit tests pass (≥ 95% coverage on hierarchy modules)
- [ ] Integration tests pass for putHierarchical, getByPath, listChildren, repairHierarchy
- [ ] E2E tests cover full workflow: create parent → create children → query by path → reparent → verify
- [ ] Performance SLO met: p95 path lookup ≤ 50ms on 10k document dataset
- [ ] Documentation updated: /docs/api-reference.md with hierarchy methods, /README.md with hierarchy overview
- [ ] Observability: Logs available at /packages/sdk/src/observability/logs.ts, metrics tracked in /packages/sdk/src/observability/metrics.ts
- [ ] No breaking changes to existing Store API (hierarchy is opt-in via enableHierarchy flag)
- [ ] Naming consistency: all hierarchy events use hierarchy.* prefix, all path fields named path or slugPath
```

## Contextual Adaptations

### For Bug Reports

Add **Reproducibility** section before Approach Overview:

```markdown
## Reproducibility

**Symptoms:** [Observed behavior]
**Expected:** [Correct behavior]
**Root cause:** [Technical explanation]

**Affected modules:**
- /path/to/module.ts: [What's broken]
- /path/to/dependency.ts: [How it propagates]

**Minimal reproduction:**
```typescript
// 10-15 line code snippet showing bug
```
```

### For Features

Add **API Contracts** section after Approach Overview:

```markdown
## API Contracts

### Public API Changes

**New exports in /packages/sdk/src/index.ts:**
- `functionName(args): ReturnType`: [Purpose and contract]

**Breaking changes:** [List any breaking changes or "None"]

### Internal Contracts

**Module boundaries:**
- [Module A] provides [interface] to [Module B]
- [Module B] must never directly access [Module A's internal state]
```

### For Security Issues

Add **Attack Surfaces** section before Edge Cases & Risks:

```markdown
## Attack Surfaces

### Surface 1: [Entry point]
**Threat:** [Attack vector]
**Validation:** [Input validation approach]
**Mitigation:** [Defense strategy]

### Surface 2: [Another entry point]
[Continue pattern...]

**Audit trail:**
- Log security-relevant events at [location]
- Track failed validations in [metric]
```

## Naming Conventions

Always include a brief **Naming Note** in the Acceptance Checklist:

```markdown
**Naming consistency:**
- Module filenames: kebab-case (e.g., hierarchy-manager.ts)
- Exported types: PascalCase (e.g., MaterializedPath)
- Functions: camelCase (e.g., validateMaterializedPath)
- Log events: dot.notation (e.g., hierarchy.put.start)
- Metric keys: snake_case (e.g., hierarchy_put_duration_ms)
- File paths: absolute from repo root (e.g., /packages/sdk/src/types.ts)
```

## Quality Checklist

Before posting comment, verify:

- [ ] No Markdown links to files/directories
- [ ] File paths are plain text, absolute from repo root
- [ ] Code symbols use inline code (backticks): `Store.put()`
- [ ] Filenames are NOT in backticks
- [ ] All sections present in correct order
- [ ] Concrete abort criteria specified
- [ ] Performance SLO or target stated (if applicable)
- [ ] No AI self-references or apologies
- [ ] No TODOs or "we should consider" (make firm recommendations)
- [ ] No code snippets > 20 lines
- [ ] Observability points to actual file paths (no links)

## Anti-Patterns to Avoid

❌ **Don't:**
- Link to files: `[store.ts](/packages/sdk/src/store.ts)`
- Backtick filenames: `The file named \`store.ts\` contains...`
- Vague acceptance: "Tests should pass"
- Weak rollback: "Revert if things break"
- Generic naming: "Use good names"
- External links: "See MongoDB docs for details"
- Placeholders: "TODO: figure out the approach"

✅ **Do:**
- Plain paths: /packages/sdk/src/store.ts
- Inline code for symbols: `Store.put()` in /packages/sdk/src/store.ts
- Specific acceptance: "p95 query latency ≤ 50ms on 10k docs"
- Concrete rollback: "Set enableHierarchy=false, restart server, run repairHierarchy()"
- Explicit naming: "Use hierarchy.* prefix for log events"
- Self-contained: All context in comment
- Firm decisions: "Use LockManager per parent ID"

## Example Comment (Bug)

```markdown
## Reproducibility

**Symptoms:** Store.query() returns stale data after Store.put() when document is cached
**Expected:** Cache should invalidate on write, query should return fresh data
**Root cause:** DocumentCache.delete() not called in Store.put() after atomicWrite() completes

**Affected modules:**
- /packages/sdk/src/store.ts: Store.put() missing cache invalidation
- /packages/sdk/src/cache.ts: DocumentCache has correct delete() method but not invoked

**Minimal reproduction:**
```typescript
const store = openStore({ root: './data' });
await store.put({ type: 'task', id: '1' }, { type: 'task', id: '1', status: 'open' });
await store.get({ type: 'task', id: '1' }); // Cached
await store.put({ type: 'task', id: '1' }, { type: 'task', id: '1', status: 'closed' });
const result = await store.query({ type: 'task', filter: { status: { $eq: 'closed' } } });
// BUG: result is empty, cached version still has status: 'open'
```

## Goal

Fix cache invalidation in Store.put() to ensure queries always see fresh data after writes. All existing tests must pass, and new test must cover this specific scenario (write → cache → write → query).

## Approach Overview

1. /packages/sdk/src/store.ts - Add cache.delete() call in Store.put() after successful write
2. /packages/sdk/src/cache.ts - Verify delete() handles missing keys gracefully
3. /packages/sdk/src/store.test.ts - Add regression test for cache invalidation on write

## Step-by-Step Plan

### Step 1: Cache Invalidation - Fix Store.put()

**Location:** /packages/sdk/src/store.ts

**Changes:**
- Add this.cache.delete(filePath) after atomicWrite() succeeds in Store.put()
- Place invalidation in try block before optional git commit
- Ensure invalidation happens even if git commit fails

**Key interfaces:**
- `DocumentCache.delete(filePath: string): void`: Removes entry from cache, no-op if missing

**Invariants:**
- Cache must be invalidated before Store.put() returns
- Cache invalidation failure must not fail the write (log warning instead)
- Git commit happens after cache invalidation

**Expected outcome:** Store.put() invalidates cache on every write; queries see fresh data

### Step 2: Cache Delete Safety - Verify Graceful Handling

**Location:** /packages/sdk/src/cache.ts

**Changes:**
- Review DocumentCache.delete() implementation
- Ensure no error thrown if key not in cache
- Log debug message when deleting non-existent key (optional)

**Expected outcome:** Cache delete is always safe to call, even for non-cached keys

### Step 3: Regression Test - Cache Invalidation Coverage

**Location:** /packages/sdk/src/store.test.ts

**Changes:**
- Add test case "should invalidate cache on write" under Store.put() suite
- Test sequence: write doc → get doc (cache hit) → write doc with change → query for new value
- Assert query returns updated value, not cached stale value

**Expected outcome:** Test fails on current code, passes after fix

## Tests

### Unit Tests

**Location:** /packages/sdk/src/store.test.ts

**Test cases:**
- Cache invalidation on put: write → cache → write → query returns fresh data
- Cache invalidation on remove: write → cache → remove → query returns empty
- Cache invalidation with git commit failure: cache still invalidated

**Location:** /packages/sdk/src/cache.test.ts

**Test cases:**
- delete() with non-existent key does not throw
- delete() with cached key removes entry

### Integration Tests

**Location:** /packages/sdk/src/store.integration.test.ts

**Test cases:**
- Multi-write scenario: 10 writes to same doc, query always sees latest
- Concurrent writes: ensure cache invalidation is thread-safe (if applicable)

### Running Tests

```bash
pnpm --filter @jsonstore/sdk test store.test.ts
pnpm --filter @jsonstore/sdk test cache.test.ts
pnpm --filter @jsonstore/sdk test store.integration.test.ts
```

## Edge Cases & Risks

### Edge Case: Cache Invalidation Failure
**Risk:** If cache.delete() throws, Store.put() fails entire operation
**Mitigation:** Wrap cache.delete() in try-catch, log warning and continue (write success is more important than cache state)

### Performance Risk: Frequent Writes to Hot Keys
**Risk:** Repeated writes to same document trash cache, no benefit from caching
**Mitigation:** Expected behavior; cache is optimized for read-heavy workloads; document in performance guide

### Data Consistency Risk: Partial Cache Invalidation
**Risk:** Cache invalidation for file path but not for type-level list cache (if exists)
**Mitigation:** Audit all cache invalidation sites; ensure list() results also invalidated on write (separate issue if needed)

## Rollout & Monitoring

### Feature Flags
None required (bug fix)

### Telemetry
- **Logs:** Existing logs in /packages/sdk/src/observability/logs.ts
  - store.put event includes cache hit/miss status
  - cache.delete event logged at debug level
- **Metrics:** Existing metrics in /packages/sdk/src/observability/metrics.ts
  - cache_invalidations counter
  - query_cache_hit_rate (should decrease slightly post-fix, then stabilize)

### Rollback Plan
**Trigger conditions:**
- Tests fail after fix
- Performance regression > 10% on write operations

**Rollback procedure:**
1. Revert commit with git revert
2. Run full test suite to confirm revert works
3. Deploy reverted version

### Abort Criteria
None (this is a correctness fix, not a feature rollout)

## Acceptance Checklist

- [ ] All unit tests pass (store.test.ts, cache.test.ts)
- [ ] Integration tests pass (store.integration.test.ts)
- [ ] Regression test added for cache invalidation on write
- [ ] No performance regression: write latency p95 ≤ baseline + 5ms
- [ ] Documentation: No doc changes needed (internal bug fix)
- [ ] Observability: Cache invalidation events logged in /packages/sdk/src/observability/logs.ts

**Naming consistency:**
- Cache-related log events use cache.* prefix
- Metrics use cache_ prefix with snake_case
```

---

## JSON Store Specific Context

### Module Structure

JSON Store has four packages:
- /packages/sdk/ - Core library (types, store, query, cache, validation, I/O)
- /packages/cli/ - Command-line interface
- /packages/server/ - MCP server for AI agents
- /packages/testkit/ - Shared testing utilities

### Key Modules

**SDK Core:**
- /packages/sdk/src/store.ts - Main Store implementation (put/get/remove/list/query)
- /packages/sdk/src/types.ts - All type definitions (Key, Document, QuerySpec, etc.)
- /packages/sdk/src/cache.ts - DocumentCache with mtime/size validation
- /packages/sdk/src/query.ts - Mango query evaluator (matches, project, sortDocuments)
- /packages/sdk/src/validation.ts - Input validation (validateKey, validateDocument, sanitizePath)
- /packages/sdk/src/io.ts - Atomic file operations (atomicWrite, readDocument, removeDocument)
- /packages/sdk/src/format.ts - Deterministic JSON formatting (stableStringify)
- /packages/sdk/src/errors.ts - Custom error classes
- /packages/sdk/src/indexes.ts - Secondary index management

**Hierarchy (Advanced):**
- /packages/sdk/src/hierarchy/hierarchy-manager.ts - Parent-child relationships
- /packages/sdk/src/hierarchy/codec.ts - Path encoding/decoding, slug normalization
- /packages/sdk/src/hierarchy/lock.ts - Fine-grained locking for concurrent operations

**Schema Validation:**
- /packages/sdk/src/schema/registry.ts - JSON Schema storage and compilation
- /packages/sdk/src/schema/validator.ts - Runtime validation with AJV
- /packages/sdk/src/schema/formats.ts - Custom format validators

**Observability:**
- /packages/sdk/src/observability/logs.ts - Structured logging
- /packages/sdk/src/observability/metrics.ts - Performance metrics

### Common Patterns

**Deterministic Formatting:**
- All documents formatted with stableStringify() for clean Git diffs
- Stable alphabetical key ordering (or custom order)
- 2-space indentation, trailing newline

**Atomic Operations:**
- Write to temp file, fsync, rename pattern in io.ts
- Cache invalidation after writes in store.ts

**Query Execution:**
- Filter evaluation in query.ts via matches() function
- Supports all Mango operators: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $exists, $type, $and, $or, $not
- Dot-path support for nested fields: author.name, meta.tags.0

**Index Management:**
- Optional equality indexes in _indexes/ sidecar files
- Automatic maintenance on put/remove operations
- Query optimizer uses indexes when available

### Performance Targets

- Small dataset (1,000 docs): cold query < 150ms, warm < 30ms, indexed < 10ms
- Medium dataset (10,000 docs): cold query < 1.5s, warm < 300ms, indexed < 50ms
- Write operations: single < 10ms, batch (10 docs) < 100ms
- Git commit overhead: < 200ms

### Test Conventions

- Unit tests: .test.ts suffix
- Integration tests: .integration.test.ts suffix
- Performance benchmarks: opt-in with VITEST_PERF=1
- Run tests: `pnpm --filter @jsonstore/<package> test`

---

**End of Guide**
