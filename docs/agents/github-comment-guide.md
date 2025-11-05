# GitHub Issue Comment Guide for AI Agents

**Purpose:** When an AI agent reviews a JSON Store GitHub issue, this guide defines what supplementary value to add in a comment.

**Key Principle:** Issues already provide problem statements, user stories, affected files, and basic acceptance criteria. **Your comment should ADD architectural guidance, not repeat what's already there.**

---

## What the Issue Already Provides

Most JSON Store issues include:
- **Summary/Problem Statement** - What's broken or needed
- **User Story** - Who needs it and why
- **Current State** - Existing code references
- **Proposed Solution** - Basic approach or options
- **Affected Components** - Files to modify
- **Tasks** - High-level checklist
- **Acceptance Criteria** - Basic success conditions
- **Alternatives Considered** - Other approaches

## What Your Comment Should ADD

Provide **architectural guidance** the issue doesn't cover:

### 1. Make Architectural Decisions
If the issue proposes multiple options (e.g., "Option 1: separate command" vs "Option 2: extend flag"), **choose one** with technical rationale.

**Example:**
> Confirm Option 1 (separate command). This keeps CLI semantics clean: `ensure-index` is idempotent (safe to run multiple times), while `reindex` is destructive (forces rebuild). Separate commands allow richer progress reporting without polluting ensure-index output.

### 2. Define Module Boundaries & Data Flow
Explain HOW components interact, not just WHICH files to modify.

**Example:**
> Data flow: CLI command → Store.rebuildIndexes() → IndexManager.buildIndex() → atomicWrite(). Store coordinates the operation but IndexManager owns index logic. CLI should never directly touch index files.

### 3. Specify Implementation Sequence
What order to build things (dependencies matter).

**Example:**
> Build order: (1) Add Store.listIndexes() first (Step 1), (2) then Store.rebuildIndexes() using listIndexes (Step 2), (3) finally wire CLI command (Step 3). CLI cannot be built without SDK methods.

### 4. Add Technical Details
Function signatures, key data structures, algorithms, invariants.

**Example:**
> Add `Store.rebuildIndexes(type: string, fields?: string[]): Promise<RebuildStats>` where RebuildStats = { docsScanned: number, indexesRebuilt: number, durationMs: number }. If fields omitted, read from store config. Must delete index files before rebuild (atomic replacement).

### 5. Identify Edge Cases & Risks
What can go wrong that the issue didn't mention.

**Example:**
> **Edge case:** Index file locked by another process. **Mitigation:** Catch delete errors, log warning, proceed with rebuild (atomicWrite will replace). **Performance risk:** Reindex on 50k docs > 5s appears hung. **Mitigation:** Report progress every 1000 docs.

### 6. Add Concrete Performance Targets
If issue is vague ("should be fast"), specify targets based on JSON Store standards.

**Example:**
> Performance target: p95 ≤ 2s for 10k documents, ≤ 5s for 50k documents. Report progress every 1000 docs for datasets > 5k.

### 7. Define Rollout Strategy
Feature flags, monitoring, rollback plan, abort criteria.

**Example:**
> **Telemetry:** Log index.rebuild.start/end events in /packages/sdk/src/observability/logs.ts with type, field count, duration. Track index_rebuild_duration_ms metric. **Rollback:** Not applicable (new command, no existing behavior to break). **Abort:** User can Ctrl+C anytime.

### 8. Enhance Testing Strategy
Beyond "add tests", specify WHAT to test and WHY.

**Example:**
> **Unit tests:** rebuildIndexes() with corrupted file (ensure graceful handling), with missing config (should error clearly), with partial failure (one field fails, others succeed). **Integration tests:** Verify index actually works after rebuild by running query that uses the index.

---

## File Path Rules (CRITICAL)

### ✅ CORRECT
```
Store.put() in /packages/sdk/src/store.ts validates documents.
Check /packages/sdk/src/hierarchy/ for path encoding.
```

### ❌ WRONG
```
`Store.put()` in [`store.ts`](packages/sdk/src/store.ts) validates documents.
Check the `hierarchy/` directory for path encoding.
```

**Rules:**
- **File paths:** Plain text, absolute from repo root (e.g., /packages/sdk/src/store.ts)
- **Directories:** Trailing slash (e.g., /packages/sdk/src/hierarchy/)
- **Code symbols:** Backticks for functions/types (e.g., `Store.put()`, `ValidationError`)
- **NEVER** create Markdown links for files/directories
- **NEVER** wrap filenames in backticks (backticks are for code only)

---

## Required Comment Structure

### 1. Goal (Enhance with specifics)
Issue may say: "Add reindex command"
**You add:** Performance target, integration requirements, backward compat

```markdown
## Goal

Implement `jsonstore reindex` CLI command that rebuilds indexes from documents with p95 ≤ 2s for 10k documents. Must integrate with existing IndexManager without breaking current ensure-index behavior. Command must handle corrupted index files gracefully and report progress for large datasets.
```

### 2. Approach Overview (Add architecture flow)
Issue may list: "Affected files: store.ts, cli.ts"
**You add:** Module responsibilities and data flow

```markdown
## Approach Overview

1. /packages/sdk/src/store.ts - Add Store.rebuildIndexes() (coordinates rebuild, returns stats)
2. /packages/sdk/src/indexes.ts - Extend IndexManager.buildIndex() to support force rebuild
3. /packages/cli/src/commands/reindex.ts - Implement CLI handler (parse args, display progress)
4. /packages/cli/src/cli.ts - Register command with Commander.js

Data flow: CLI → Store.rebuildIndexes() → IndexManager.buildIndex() → atomicWrite()
```

### 3. Step-by-Step Plan (Add implementation details)
Issue may have basic tasks.
**You add:** Function signatures, invariants, integration points, expected outcomes

```markdown
## Step-by-Step Plan

### Step 1: SDK Method - Add Store.rebuildIndexes()

**Location:** /packages/sdk/src/store.ts

**Changes:**
- Add method: `rebuildIndexes(type: string, fields?: string[]): Promise<RebuildStats>`
- If fields omitted, read from store.config.json indexes[type] array
- For each field: delete /data/<type>/_indexes/<field>.json, call ensureIndex(type, field)
- Return stats: { docsScanned, indexesRebuilt, durationMs }

**Key interfaces:**
- `Store.rebuildIndexes(type, fields?)`: Rebuilds indexes from scratch by deleting then recreating

**Invariants:**
- Must scan all documents even if index exists (force rebuild)
- Index deletion must not fail operation (log warning, proceed)
- Partial failure (one field fails) doesn't block others (collect errors, continue)

**Expected outcome:** SDK method works; unit tests verify stats are correct, corrupted files handled

[Continue for Steps 2-4...]
```

### 4. Tests (Specify WHAT to test and WHY)
Issue may say: "Add tests"
**You add:** Specific test cases with rationale

```markdown
## Tests

### Unit Tests

**Location:** /packages/sdk/src/store.test.ts

**Test cases:**
- rebuildIndexes() returns correct stats (docsScanned, indexesRebuilt, durationMs)
- rebuildIndexes() with corrupted index file (should delete and rebuild successfully)
- rebuildIndexes() with missing store config (should throw clear error)
- rebuildIndexes() with partial failure (one field fails, returns error but rebuilds others)

**Why:** Ensure stats are accurate for user feedback, corrupted files don't crash operation, errors are actionable

### Integration Tests

**Location:** /packages/cli/test/cli.test.ts

**Test cases:**
- `jsonstore reindex task status` rebuilds index, subsequent query uses index (verify speed)
- `jsonstore reindex task --all` rebuilds all configured indexes (not just one)
- Reindex with no configured indexes returns helpful error

**Why:** Verify end-to-end flow works, performance benefit is real, error messages guide users

### Running Tests
```bash
pnpm --filter @jsonstore/sdk test store.test.ts
pnpm --filter @jsonstore/cli test cli.test.ts
```
```

### 5. Edge Cases & Risks (Add what issue missed)
Issue may mention basic failure modes.
**You add:** Non-obvious edge cases, mitigation strategies

```markdown
## Edge Cases & Risks

### Edge Case: Concurrent Reindex Operations
**Risk:** Two reindex commands run simultaneously on same type, corrupt index
**Mitigation:** IndexManager uses file locking per type (existing pattern), second command waits or fails fast with clear error

### Performance Risk: Large Datasets
**Risk:** Reindex on 50k+ docs takes > 5s, appears hung, user assumes crash
**Mitigation:** Emit progress every 1000 docs: "Scanned 5000/50000 documents..." (add to CLI output)

### Data Risk: Store Modified During Rebuild
**Risk:** Document added/removed during index scan, index inconsistent at completion
**Mitigation:** Accept eventual consistency (document in help text), or add "freeze" mode (reject writes during reindex - optional, scope creep)
```

### 6. Rollout & Monitoring (Add observability details)
Issue may not mention monitoring at all.
**You add:** Logs, metrics, rollback, abort criteria

```markdown
## Rollout & Monitoring

### Feature Flags
None (new CLI command, opt-in by user)

### Telemetry
- **Logs:** /packages/sdk/src/observability/logs.ts
  - `index.rebuild.start` event with { type, fields, timestamp }
  - `index.rebuild.end` event with { type, fields, docsScanned, duration, timestamp }
  - `index.rebuild.error` event with { type, field, error, timestamp }
- **Metrics:** /packages/sdk/src/observability/metrics.ts
  - `index_rebuild_duration_ms` (p50, p95, p99)
  - `index_rebuild_doc_count` (histogram)

### Rollback Plan
Not applicable (new command, no existing behavior affected)

### Abort Criteria
None (user-initiated command, can Ctrl+C anytime)
```

### 7. Acceptance Checklist (Add specifics)
Issue may have generic "tests pass" criteria.
**You add:** Measurable, specific success conditions

```markdown
## Acceptance Checklist

- [ ] All unit tests pass with ≥ 95% coverage on rebuildIndexes() method
- [ ] Integration tests verify: (1) rebuilt index actually works in queries, (2) progress reporting shows for large datasets
- [ ] Performance: reindex of 10k docs completes in ≤ 2s, 50k docs in ≤ 5s
- [ ] Error handling: corrupted files logged but don't crash, missing config gives actionable error
- [ ] Documentation: /docs/api-reference.md documents Store.rebuildIndexes(), CLI help shows `jsonstore reindex --help` with examples
- [ ] Observability: Events logged in /packages/sdk/src/observability/logs.ts, metrics tracked in metrics.ts

**Naming consistency:**
- CLI command: `reindex` (kebab-case)
- SDK method: `rebuildIndexes` (camelCase)
- Log events: `index.rebuild.*` (dot.notation)
- Metrics: `index_rebuild_*` (snake_case)
```

---

## JSON Store Implementation Patterns

Use these patterns when recommending architecture:

### Adding a Store Method
**Flow:** types.ts (interface) → store.ts (implement) → index.ts (export) → test files → CLI/MCP (if user/agent-facing) → docs
**Key points:** Cache invalidation after writes, use atomicWrite(), validate inputs, throw specific errors

### Adding a CLI Command
**Flow:** cli.ts (register) → commands/<name>.ts (handler) → wire to SDK → handle I/O flags → error codes → tests
**Exit codes:** 0=success, 1=validation, 2=not found, 3=I/O error

### Adding an MCP Tool
**Flow:** schemas.ts (Zod) → tools.ts (definition) → service/ (handler) → wire to SDK → tests → docs
**Key points:** Validate with Zod, return JSON errors, log tool invocations, consider rate limits

### Adding an Index Type
**Flow:** Design sidecar format → indexes.ts (builder) → Store.put/remove (maintenance) → query optimizer (use it) → consistency check → tests
**Key points:** Atomic updates (write-then-rename), fallback to full scan if unusable, provide rebuild tool

---

## JSON Store Context

### Module Structure
- /packages/sdk/src/ - Core (store, query, cache, validation, I/O, indexes, hierarchy, schema, observability)
- /packages/cli/src/ - CLI commands
- /packages/server/src/ - MCP server tools
- /packages/testkit/src/ - Test utilities

### Performance Targets
- Small (1k docs): cold < 150ms, warm < 30ms, indexed < 10ms
- Medium (10k docs): cold < 1.5s, warm < 300ms, indexed < 50ms
- Write ops: single < 10ms, batch (10 docs) < 100ms

### Key Files
- /packages/sdk/src/store.ts - Store.put/get/remove/list/query
- /packages/sdk/src/types.ts - All type definitions
- /packages/sdk/src/query.ts - Mango evaluator (matches, project, sort)
- /packages/sdk/src/validation.ts - Input validation (validateKey, validateDocument)
- /packages/sdk/src/io.ts - Atomic operations (atomicWrite)
- /packages/sdk/src/indexes.ts - Index management
- /packages/sdk/src/cache.ts - DocumentCache with mtime/size validation

---

## Quality Checklist (Before Posting)

- [ ] Made architectural decision if issue proposed options
- [ ] Defined module boundaries and data flow
- [ ] Specified function signatures for new APIs
- [ ] Added edge cases not in issue
- [ ] Provided concrete performance targets (not "fast")
- [ ] Specified observability (log/metric locations with file paths)
- [ ] Enhanced testing strategy (what + why)
- [ ] File paths are plain text, absolute from repo root
- [ ] Code symbols use backticks, filenames do not
- [ ] No Markdown links to files/directories
- [ ] No vague criteria ("tests should pass" → "≥95% coverage, p95 ≤ 50ms")
- [ ] No TODOs or "we should consider" (make firm recommendations)

---

## Example: Adding Value to an Issue

**Issue says:**
> Add `jsonstore reindex` command to rebuild corrupted indexes
>
> Files: packages/cli/src/cli.ts, packages/sdk/src/indexes.ts
>
> Acceptance: Command works, tests pass

**Your comment adds:**

```markdown
## Goal

Implement `jsonstore reindex` CLI command with p95 ≤ 2s for 10k documents. Must handle corrupted files gracefully, report progress for large datasets, integrate with existing IndexManager.

## Approach Overview

1. /packages/sdk/src/store.ts - Add Store.rebuildIndexes() coordinating rebuild
2. /packages/sdk/src/indexes.ts - Extend IndexManager to support force rebuild
3. /packages/cli/src/commands/reindex.ts - CLI handler with progress reporting
4. /packages/cli/src/cli.ts - Register command

Data flow: CLI → Store.rebuildIndexes() → IndexManager.buildIndex() → atomicWrite()
Store coordinates but never directly touches index files (IndexManager owns format).

## Step-by-Step Plan

### Step 1: SDK Method - Store.rebuildIndexes()

**Location:** /packages/sdk/src/store.ts

**Changes:**
- Add `rebuildIndexes(type: string, fields?: string[]): Promise<RebuildStats>`
- If fields omitted, read from store.config.json indexes[type]
- For each field: delete index file, call IndexManager.buildIndex()
- Return { docsScanned, indexesRebuilt, durationMs, errors }

**Key interfaces:**
- `Store.rebuildIndexes(type, fields?)`: Force rebuild by deleting then recreating indexes

**Invariants:**
- Must scan all documents (no shortcuts even if index exists)
- Deletion errors logged but don't fail operation (write will replace)
- Partial failures collected, operation continues

**Expected outcome:** SDK method works, stats accurate, corrupted files handled

[Continue Steps 2-4...]

## Tests

### Unit Tests
**Location:** /packages/sdk/src/store.test.ts
- rebuildIndexes() returns correct stats
- Handles corrupted index file (deletes, rebuilds successfully)
- Partial failure (one field fails, others succeed, errors collected)

**Why:** Stats guide user, corrupted files don't crash, errors actionable

### Integration Tests
**Location:** /packages/cli/test/cli.test.ts
- `jsonstore reindex task status` rebuilds, query verifies index works (speed check)
- Progress reporting for 5k+ doc datasets

**Why:** Verify end-to-end flow, performance benefit real

## Edge Cases & Risks

### Edge Case: Concurrent Reindex
**Risk:** Two reindex commands on same type corrupt index
**Mitigation:** IndexManager file locking (existing), second command waits or fails with error

### Performance Risk: Large Datasets Appear Hung
**Risk:** 50k docs reindex > 5s, user assumes crash
**Mitigation:** Emit progress every 1000 docs: "Scanned 5000/50000..."

## Rollout & Monitoring

**Telemetry:**
- Logs: /packages/sdk/src/observability/logs.ts with index.rebuild.* events
- Metrics: index_rebuild_duration_ms in metrics.ts

**Rollback:** Not applicable (new command)
**Abort:** User can Ctrl+C anytime

## Acceptance Checklist

- [ ] Unit tests pass ≥95% coverage on rebuildIndexes()
- [ ] Integration tests verify rebuilt index works in queries
- [ ] Performance: 10k docs ≤ 2s, 50k docs ≤ 5s
- [ ] Corrupted files handled gracefully (logged, not crashed)
- [ ] Documentation: API reference + CLI help updated
- [ ] Observability: Events in logs.ts, metrics in metrics.ts

**Naming:** reindex (CLI), rebuildIndexes (SDK), index.rebuild.* (logs), index_rebuild_* (metrics)
```

---

**Remember:** Your goal is to provide architectural guidance that saves the developer from making design decisions. Be specific, be concrete, make firm recommendations.

