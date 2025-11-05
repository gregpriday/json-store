# GitHub Issue Analysis Guide for AI Agents

**Purpose:** Provide a comprehensive codebase map for the issue, so the implementing agent can start coding immediately without extensive exploration.

**Your Goal:** Read the issue, explore the relevant parts of the codebase, then create a comment that gives the implementing agent a complete picture of:
- What existing functions/classes to use
- Where they're located
- How they work together
- What patterns to follow

---

## Your Analysis Process

### Step 1: Understand the Issue
- What feature is being added or fixed?
- What files does the issue mention?
- Are there multiple approaches proposed?

### Step 2: Map the Relevant Code
Find and read the relevant existing code:

**If adding a Store method:**
- Locate similar methods in /packages/sdk/src/store.ts
- Check how they're defined in /packages/sdk/src/types.ts
- Find what they call (IndexManager, HierarchyManager, validation functions, etc.)
- Note error handling patterns and return types

**If adding a CLI command:**
- Find similar commands in /packages/cli/src/commands/
- Check how they're registered in /packages/cli/src/cli.ts
- See what SDK methods they call
- Note argument parsing and output patterns

**If adding an MCP tool:**
- Find similar tools in /packages/server/src/tools.ts
- Check schemas in /packages/server/src/schemas.ts
- See what SDK methods they call
- Note validation and error response patterns

**If adding an index type:**
- Read /packages/sdk/src/indexes.ts to understand IndexManager
- Check how indexes are updated in Store.put() and Store.remove()
- See how the query optimizer uses indexes in /packages/sdk/src/query.ts
- Note the sidecar file format

**If modifying validation:**
- Read /packages/sdk/src/validation.ts for existing validators
- Check /packages/sdk/src/errors.ts for error types
- See where validation is called from

### Step 3: Document the Architecture
For the implementing agent, document:
1. **Existing functions to use** - Name, location, signature, purpose
2. **New functions to create** - Where they should go, what they should do
3. **Data flow** - How components interact (A calls B calls C)
4. **Patterns to follow** - How similar features are structured
5. **Integration points** - Where to hook into existing code
6. **Dependencies** - What must be built first

---

## Your Comment Structure

### Section 1: Relevant Existing Code

Tell the agent exactly what's already there and where to find it:

```markdown
## Relevant Existing Code

**Index operations (the pattern to follow):**
- `Store.ensureIndex(type, field)` in /packages/sdk/src/store.ts lines 340-365
  - Validates type/field, then delegates to IndexManager
  - Returns void, throws on validation errors
  - Calls `IndexManager.buildIndex(type, field)` to do actual work

- `IndexManager.buildIndex(type, field)` in /packages/sdk/src/indexes.ts lines 120-180
  - Scans all documents of type, builds map { value: [ids] }
  - Writes to /data/<type>/_indexes/<field>.json using atomicWrite()
  - Returns index stats: { field, entries, durationMs }

**CLI command pattern (the structure to copy):**
- `ensure-index` command in /packages/cli/src/commands/ensure-index.ts
  - Registered in cli.ts: `program.command('ensure-index <type> <field>')`
  - Opens store from --dir or DATA_ROOT
  - Calls `store.ensureIndex(type, field)`
  - Displays success message with field name
  - Exit codes: 0=success, 1=validation error, 3=I/O error

**Similar operations for reference:**
- `Store.format()` in /packages/sdk/src/store.ts lines 400-450
  - Returns stats: { docsFormatted, durationMs }
  - Reports progress for large datasets (> 1000 docs)
  - Logs format.start/end events in observability/logs.ts
```

### Section 2: Implementation Map

Give the agent a complete roadmap:

```markdown
## Implementation Map

**What to build:**

1. **SDK Method: Store.rebuildIndexes()**
   - Location: Add to /packages/sdk/src/store.ts after ensureIndex (around line 370)
   - Signature: `async rebuildIndexes(type: string, fields?: string[]): Promise<RebuildStats>`
   - Logic:
     - If fields is undefined, read from `this.options.indexes[type]` (same pattern as format)
     - For each field: delete /data/<type>/_indexes/<field>.json, then call `IndexManager.buildIndex(type, field)`
     - Collect stats: total docs scanned, indexes rebuilt, duration
     - Log errors but continue to next field (pattern from ensureIndex)
   - Returns: `{ docsScanned: number, indexesRebuilt: number, durationMs: number }`
   - Calls: `IndexManager.buildIndex()` (already exists), `removeDocument()` for delete

2. **Type Definition: RebuildStats**
   - Location: Add to /packages/sdk/src/types.ts (around line 300 near other stats types)
   - Definition: `{ docsScanned: number; indexesRebuilt: number; durationMs: number }`
   - Export from /packages/sdk/src/index.ts

3. **CLI Command: reindex**
   - Location: Create /packages/cli/src/commands/reindex.ts (copy structure from ensure-index.ts)
   - Register in /packages/cli/src/cli.ts: `program.command('reindex <type> [fields...]')`
   - Logic:
     - Parse args: type (required), fields (optional array)
     - Open store from --dir or DATA_ROOT
     - Call `store.rebuildIndexes(type, fields)`
     - Display: "Rebuilt 3 indexes: status (50 entries), priority (12 entries), assignee (8 entries) in 1.2s"
   - Flags: `--all` to rebuild all configured indexes (pass undefined for fields)

**Data flow:**
```
CLI command (reindex.ts)
  → Store.rebuildIndexes(type, fields) [store.ts]
    → For each field:
      → Remove index file (if exists)
      → IndexManager.buildIndex(type, field) [indexes.ts]
        → Scan documents
        → Build index map
        → atomicWrite() to save [io.ts]
    → Return stats
  → Display results
```

**Build order:**
1. Add RebuildStats type to types.ts (no dependencies)
2. Add Store.rebuildIndexes() method (depends on RebuildStats, uses existing IndexManager)
3. Export from index.ts (depends on rebuildIndexes existing)
4. Add CLI command (depends on Store.rebuildIndexes being available)
5. Register in cli.ts (depends on command file existing)
```

### Section 3: Patterns & Edge Cases

Document what the agent needs to know about:

```markdown
## Patterns to Follow

**From Store.ensureIndex and IndexManager.buildIndex:**
- Store coordinates, IndexManager owns index format (separation of concerns)
- Use atomicWrite() for all index file operations (consistency guarantee)
- Validate inputs before delegating (fail fast principle)
- Log errors per field but continue rebuilding others (partial failure tolerance)

**From Store.format operation:**
- Return stats object with counts and duration (user feedback)
- Report progress for large datasets: emit event every 1000 docs (UX for long operations)
- Read config from this.options.indexes[type] when --all flag used (config pattern)

**From CLI commands:**
- Exit code 1 for validation errors (invalid type/field)
- Exit code 3 for I/O errors (file system issues)
- Display human-readable output with statistics (don't just log JSON)

## Edge Cases to Handle

**From existing index code:**
1. **Corrupted index file:** IndexManager.buildIndex already handles this by rebuilding, rebuildIndexes should explicitly delete first to force rebuild
2. **Missing type directory:** Store.list() handles this, rebuildIndexes will inherit (returns empty if no docs)
3. **Partial field failure:** Store.ensureIndex logs error but continues, rebuildIndexes should collect errors in array, log each, return partial stats
4. **No configured indexes:** If --all flag but no indexes[type] in config, return helpful error: "No indexes configured for type 'X'"

**Performance considerations:**
- For > 5k documents, report progress: "Scanned 5000/12000 documents..."
- Target: < 2s for 10k docs (matches Store.format SLO)
- Use existing DocumentCache for reads (already wired in Store.list)

## Observability

**Logging (add to /packages/sdk/src/observability/logs.ts):**
- Event: `index.rebuild.start` with { type, fields, timestamp }
- Event: `index.rebuild.end` with { type, fields, docsScanned, indexesRebuilt, durationMs, timestamp }
- Event: `index.rebuild.error` with { type, field, error, timestamp }

**Metrics (add to /packages/sdk/src/observability/metrics.ts):**
- Metric: `index_rebuild_duration_ms` (histogram with p50, p95, p99)
- Metric: `index_rebuild_doc_count` (counter)

Pattern: Follow existing index.build.* events in same files
```

### Section 4: Files to Modify

Be explicit about every file:

```markdown
## Files to Modify

**Primary implementation:**
1. /packages/sdk/src/types.ts - Add RebuildStats interface (3 lines)
2. /packages/sdk/src/store.ts - Add rebuildIndexes() method (~50 lines after ensureIndex)
3. /packages/sdk/src/index.ts - Export rebuildIndexes and RebuildStats (2 lines)
4. /packages/cli/src/commands/reindex.ts - New file, ~80 lines (copy structure from ensure-index.ts)
5. /packages/cli/src/cli.ts - Register command (5 lines, after ensure-index command)

**Supporting files:**
6. /packages/sdk/src/observability/logs.ts - Add rebuild events (10 lines, near index.build events)
7. /packages/sdk/src/observability/metrics.ts - Add rebuild metrics (5 lines, near index.build metrics)

**Test files:**
8. /packages/sdk/src/store.test.ts - Add rebuildIndexes tests (~50 lines)
9. /packages/cli/test/cli.test.ts - Add reindex command tests (~40 lines)

**Documentation:**
10. /docs/api-reference.md - Document Store.rebuildIndexes() method
11. /docs/cli.md or help text - Document reindex command usage

**No changes needed:**
- /packages/sdk/src/indexes.ts - IndexManager.buildIndex already works, just call it
- /packages/sdk/src/io.ts - atomicWrite already used by IndexManager
```

---

## File Path Rules

When referencing files:

### ✅ CORRECT
```
Store.ensureIndex() in /packages/sdk/src/store.ts lines 340-365
The IndexManager class in /packages/sdk/src/indexes.ts
Check /packages/cli/src/commands/ for command examples
```

### ❌ WRONG
```
`Store.ensureIndex()` in [`store.ts`](packages/sdk/src/store.ts) lines 340-365
The `IndexManager` class in [`indexes.ts`](/packages/sdk/src/indexes.ts)
Check the `commands/` directory for examples
```

**Rules:**
- **File paths:** Plain text, absolute from repo root
- **Directories:** Trailing slash
- **Code symbols:** Backticks (e.g., `Store.put()`, `IndexManager`)
- **Line numbers:** Plain text (e.g., "lines 340-365")
- **NEVER** create Markdown links
- **NEVER** wrap filenames in backticks

---

## Analysis Checklist

Before posting your comment, verify you've documented:

**Existing Code:**
- [ ] Located similar features and documented their locations/line numbers
- [ ] Documented function signatures and what they do
- [ ] Identified what existing functions to call
- [ ] Found patterns in similar features

**Implementation Map:**
- [ ] Listed every new function/type to create with location
- [ ] Provided function signatures and return types
- [ ] Documented data flow (A → B → C)
- [ ] Specified build order (dependencies)

**Patterns & Edge Cases:**
- [ ] Documented patterns from similar features
- [ ] Listed edge cases from existing code
- [ ] Provided performance targets
- [ ] Documented observability patterns

**Files:**
- [ ] Listed every file to modify with line counts
- [ ] Noted files that don't need changes
- [ ] Included test files

---

## Example Comment

**Issue:** Add `jsonstore reindex` command to rebuild indexes

**Your comment:**

```markdown
## Relevant Existing Code

**Index operations (pattern to follow):**
- `Store.ensureIndex(type, field)` in /packages/sdk/src/store.ts lines 340-365
  - Validates, then calls IndexManager.buildIndex()
  - Returns void, throws ValidationError on bad input

- `IndexManager.buildIndex(type, field)` in /packages/sdk/src/indexes.ts lines 120-180
  - Scans docs, builds map, writes with atomicWrite()
  - Returns { field, entries, durationMs }

**CLI command pattern:**
- `ensure-index` in /packages/cli/src/commands/ensure-index.ts
  - Structure: parse args → open store → call SDK → display results
  - Exit codes: 0=success, 1=validation, 3=I/O

**Similar stat-returning operation:**
- `Store.format()` in /packages/sdk/src/store.ts lines 400-450
  - Returns { docsFormatted, durationMs }
  - Reports progress > 1000 docs
  - Reads config from this.options when --all flag

## Implementation Map

**1. Add RebuildStats type**
- Location: /packages/sdk/src/types.ts line ~300 (near StoreStats)
- Definition: `interface RebuildStats { docsScanned: number; indexesRebuilt: number; durationMs: number }`
- Export from /packages/sdk/src/index.ts

**2. Add Store.rebuildIndexes() method**
- Location: /packages/sdk/src/store.ts after ensureIndex (line ~370)
- Signature: `async rebuildIndexes(type: string, fields?: string[]): Promise<RebuildStats>`
- Logic:
  ```typescript
  // If fields undefined, read from this.options.indexes[type]
  const fieldsToRebuild = fields ?? this.options.indexes?.[type] ?? [];

  // For each field:
  //   1. Delete index file: this.#removeIndexFile(type, field)
  //   2. Rebuild: await this.#indexManager.buildIndex(type, field)
  //   3. Collect stats

  // Return { docsScanned, indexesRebuilt, durationMs }
  ```
- Calls:
  - `IndexManager.buildIndex()` (already exists in indexes.ts)
  - `removeDocument()` from io.ts to delete index file
  - `list(type)` to get document count

**3. Add CLI command**
- Location: Create /packages/cli/src/commands/reindex.ts
- Register: /packages/cli/src/cli.ts add `program.command('reindex <type> [fields...]')`
- Structure: (copy from ensure-index.ts)
  ```typescript
  // Parse: type (required), fields (optional array)
  // Open store from --dir or DATA_ROOT
  // Call: stats = await store.rebuildIndexes(type, fields)
  // Display: "Rebuilt 3 indexes: status (50), priority (12) in 1.2s"
  ```
- Flag: `--all` passes undefined for fields (rebuilds all configured)

**Data flow:**
```
reindex.ts → Store.rebuildIndexes() → for each field:
  → remove index file
  → IndexManager.buildIndex() → atomicWrite()
→ return stats → display
```

**Build order:**
1. RebuildStats type (no deps)
2. Store.rebuildIndexes() (uses RebuildStats, calls IndexManager)
3. Export from index.ts
4. CLI command (calls Store.rebuildIndexes)
5. Register in cli.ts

## Patterns to Follow

**From Store.ensureIndex:**
- Store coordinates, IndexManager owns format
- Use atomicWrite() for index files
- Validate before delegating
- Log per-field errors but continue

**From Store.format:**
- Return stats object
- Progress reporting > 1000 docs
- Read this.options.indexes[type] for --all

**From CLI commands:**
- Exit code 1=validation, 3=I/O
- Human-readable output with stats

## Edge Cases

1. **Corrupted file:** Delete first to force rebuild (unlike ensureIndex which rebuilds in place)
2. **No docs:** list() returns [], buildIndex handles empty gracefully
3. **Partial failure:** Log error, continue to next field, return partial stats
4. **No config:** If --all but no indexes[type], error: "No indexes configured for type 'X'"
5. **Progress:** Report every 1000 docs for > 5k datasets

**Performance:** Target < 2s for 10k docs (matches format SLO)

## Observability

**Add to /packages/sdk/src/observability/logs.ts (near index.build.* events):**
- `index.rebuild.start` with { type, fields }
- `index.rebuild.end` with { type, fields, docsScanned, indexesRebuilt, durationMs }
- `index.rebuild.error` with { type, field, error }

**Add to /packages/sdk/src/observability/metrics.ts:**
- `index_rebuild_duration_ms` (histogram)
- `index_rebuild_doc_count` (counter)

## Files to Modify

**Primary:**
1. /packages/sdk/src/types.ts - Add RebuildStats (3 lines near StoreStats)
2. /packages/sdk/src/store.ts - Add rebuildIndexes() (~50 lines after ensureIndex)
3. /packages/sdk/src/index.ts - Export rebuildIndexes, RebuildStats (2 lines)
4. /packages/cli/src/commands/reindex.ts - New file (~80 lines, copy ensure-index structure)
5. /packages/cli/src/cli.ts - Register command (5 lines after ensure-index)

**Supporting:**
6. /packages/sdk/src/observability/logs.ts - Add events (10 lines)
7. /packages/sdk/src/observability/metrics.ts - Add metrics (5 lines)

**Tests:**
8. /packages/sdk/src/store.test.ts - rebuildIndexes tests (~50 lines)
9. /packages/cli/test/cli.test.ts - reindex command tests (~40 lines)

**No changes needed:**
- /packages/sdk/src/indexes.ts (IndexManager.buildIndex already works)
- /packages/sdk/src/io.ts (atomicWrite already used)
```

---

## Key Principle

Your comment should be a **complete reference** that lets the implementing agent start coding immediately without exploring the codebase themselves.

Think of it as writing documentation for a new developer joining the project - they need to know:
- What already exists and where
- What to build and where
- How it all connects
- What patterns to follow

