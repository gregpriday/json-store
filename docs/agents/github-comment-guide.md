# GitHub Issue Exploration Guide for AI Agents

**Purpose:** When an AI agent reviews a JSON Store GitHub issue, spend 5-10 minutes exploring the codebase to understand how the feature should be implemented, then provide a comment with your findings.

**Key Principle:** The issue describes WHAT needs to be done. Your job is to explore the codebase and figure out HOW it should be done, then share that architectural understanding.

---

## Your Exploration Process (5-10 minutes)

### Phase 1: Understand the Issue (1-2 min)
1. Read the issue carefully - what problem are we solving?
2. Note any options or approaches mentioned
3. Identify the affected files/components listed

### Phase 2: Explore Existing Patterns (3-5 min)
Before recommending an approach, **explore how similar features are currently implemented**:

**If adding a Store method:**
- Read /packages/sdk/src/store.ts - how are existing methods structured?
- Check /packages/sdk/src/types.ts - what's the interface pattern?
- Look at similar methods - how do they handle validation, caching, errors?
- Where do they call into (IndexManager, HierarchyManager, validation functions)?

**If adding a CLI command:**
- Read /packages/cli/src/cli.ts - how are commands registered?
- Check /packages/cli/src/commands/ - what's the handler pattern?
- Look at a similar command - how does it parse args, handle I/O, display output?
- What SDK methods does it call?

**If adding an MCP tool:**
- Read /packages/server/src/tools.ts - how are tools defined?
- Check /packages/server/src/schemas.ts - what's the Zod schema pattern?
- Look at a similar tool - how does it validate, call SDK, format responses?

**If adding an index type:**
- Read /packages/sdk/src/indexes.ts - how does IndexManager work?
- Check existing index files in a test fixture - what's the format?
- How are indexes updated in Store.put() and Store.remove()?
- Where does the query optimizer decide to use indexes?

**If adding validation:**
- Read /packages/sdk/src/validation.ts - what's the validation pattern?
- How are errors thrown? (Check /packages/sdk/src/errors.ts)
- Where is validation called from?

### Phase 3: Identify Integration Points (2-3 min)
After exploring existing code, answer:
- What existing functions/classes will this feature use?
- What new functions/classes need to be created?
- How does data flow through the system?
- What's the dependency order? (What must be built first?)
- What patterns from existing code should be followed?

### Phase 4: Consider Edge Cases (1-2 min)
Based on what you learned:
- What edge cases does the existing code handle that this feature should too?
- What failure modes exist in similar features?
- What performance considerations apply? (Check existing perf targets)
- What observability patterns are used? (Check logs/metrics in similar features)

---

## Your Comment Should Provide

After exploration, write a comment that shares **what you discovered** and **how it informs the implementation**:

### 1. Architectural Understanding
"I explored [files] and found that [pattern]. This issue should follow the same pattern because [reason]."

**Example:**
> I explored /packages/sdk/src/store.ts and /packages/sdk/src/indexes.ts. Existing index operations follow this pattern: Store method → IndexManager function → atomicWrite(). Store.ensureIndex() coordinates but IndexManager.buildIndex() owns the index format. Store.rebuildIndexes() should follow this same separation: Store orchestrates, IndexManager rebuilds.

### 2. Discovered Integration Points
"Here's how this feature integrates with existing code:"

**Example:**
> Integration points discovered:
> - Store.rebuildIndexes() should call IndexManager.buildIndex() (same as ensureIndex uses)
> - Need to read configured indexes from store.config.json (pattern used in Store constructor)
> - Should use same progress reporting pattern as format operation (emits events every N docs)
> - Errors should use existing DocumentWriteError from /packages/sdk/src/errors.ts

### 3. Implementation Sequence
"Based on dependencies in the code, build in this order:"

**Example:**
> Build order (based on existing dependencies):
> 1. First: Add Store.rebuildIndexes() method - it needs to exist before CLI can call it
> 2. Then: Update IndexManager if needed (but current buildIndex() should work as-is)
> 3. Finally: Add CLI command in /packages/cli/src/commands/reindex.ts calling Store.rebuildIndexes()
>
> This matches how ensure-index was built (SDK first, then CLI wrapper).

### 4. Patterns to Follow
"I found these patterns in similar features that this should follow:"

**Example:**
> Patterns to follow (from existing code):
> - Progress reporting: Store.format() reports every 100 docs, rebuildIndexes should do same
> - Statistics: Similar to format, return { docsScanned, indexesRebuilt, durationMs }
> - Error handling: Store.ensureIndex() logs but doesn't fail on single field errors, rebuildIndexes should too
> - Config reading: Store.format() uses this.options, rebuildIndexes should read indexes from same place

### 5. Edge Cases from Existing Code
"Similar features handle these edge cases, so this should too:"

**Example:**
> Edge cases I found in existing code:
> - Store.ensureIndex() handles corrupted index files by rebuilding (same approach for reindex)
> - Store.format() skips hidden directories (reindex should too when scanning docs)
> - IndexManager uses atomicWrite for all index updates (rebuildIndexes must follow this)
> - Store.put() validates type/id before writing (rebuildIndexes should validate before rebuilding)

### 6. Performance & Observability
"Here's what I found about performance and logging:"

**Example:**
> Performance & observability (from similar operations):
> - Store.format() targets p95 < 2s for 10k docs, rebuildIndexes should match
> - IndexManager logs index.build.start/end events, rebuildIndexes should log index.rebuild.start/end
> - Progress reporting needed for > 5k docs (pattern from format operation)
> - Metrics tracked in /packages/sdk/src/observability/metrics.ts, add index_rebuild_duration_ms

---

## File Path Rules (CRITICAL)

When referencing files you explored:

### ✅ CORRECT
```
I explored /packages/sdk/src/store.ts and found Store.ensureIndex() at lines 245-267.
The IndexManager class in /packages/sdk/src/indexes.ts handles index building.
Check the hierarchy/ directory for examples of Manager pattern.
```

### ❌ WRONG
```
I explored [`store.ts`](packages/sdk/src/store.ts) and found `Store.ensureIndex()` at lines 245-267.
The `IndexManager` class in [`indexes.ts`](/packages/sdk/src/indexes.ts) handles index building.
Check the `hierarchy/` directory for examples of Manager pattern.
```

**Rules:**
- **File paths:** Plain text, absolute from repo root (e.g., /packages/sdk/src/store.ts)
- **Directories:** Trailing slash (e.g., /packages/sdk/src/hierarchy/)
- **Code symbols:** Backticks for functions/types/classes (e.g., `Store.put()`, `IndexManager`)
- **Line references:** Plain text (e.g., "lines 245-267" or "around line 150")
- **NEVER** create Markdown links for files/directories
- **NEVER** wrap filenames in backticks (backticks are for code/symbols only)

---

## Exploration Checklist

Before writing your comment, verify you've explored:

**For any feature:**
- [ ] Read the main file mentioned in the issue
- [ ] Found and read 2-3 similar existing features
- [ ] Identified the patterns they follow
- [ ] Located the integration points (what functions/classes are called)
- [ ] Checked how errors are handled
- [ ] Found the test files for similar features
- [ ] Noted the observability patterns (logs/metrics)

**For SDK features:**
- [ ] Read /packages/sdk/src/types.ts for interface patterns
- [ ] Read /packages/sdk/src/store.ts for Store method patterns
- [ ] Read /packages/sdk/src/validation.ts for validation patterns
- [ ] Read /packages/sdk/src/errors.ts for error classes

**For CLI features:**
- [ ] Read /packages/cli/src/cli.ts for command registration
- [ ] Read 1-2 similar commands in /packages/cli/src/commands/
- [ ] Checked how they call SDK methods
- [ ] Noted argument parsing and output formatting patterns

**For MCP features:**
- [ ] Read /packages/server/src/tools.ts for tool definition patterns
- [ ] Read /packages/server/src/schemas.ts for Zod validation patterns
- [ ] Read 1-2 similar tools to see handler patterns

---

## Example Comment (After Exploration)

**Issue:** Add `jsonstore reindex` command to rebuild indexes

**Your comment after 5-10 min exploration:**

```markdown
I spent ~8 minutes exploring the codebase to understand how this should be implemented. Here's what I found:

## Existing Patterns Discovered

**Index operations pattern (from Store.ensureIndex):**
I read /packages/sdk/src/store.ts lines 340-365 and /packages/sdk/src/indexes.ts lines 120-180. The pattern is:
- Store method coordinates and validates
- IndexManager owns the index format and building logic
- Store never directly touches index files, always delegates to IndexManager
- Uses atomicWrite() for all index file operations

**CLI command pattern (from ensure-index command):**
I read /packages/cli/src/commands/ensure-index.ts. Commands follow this structure:
- Parse arguments (type, field)
- Open store with config from --dir or DATA_ROOT env
- Call SDK method (store.ensureIndex)
- Display results with statistics
- Handle errors with appropriate exit codes (1=validation, 3=I/O)

## Recommended Implementation

Based on existing patterns, here's how reindex should work:

**1. SDK Method (Store.rebuildIndexes)**
Location: /packages/sdk/src/store.ts (add after ensureIndex method around line 370)

Pattern to follow: Same as Store.ensureIndex but with force rebuild
- Signature: `rebuildIndexes(type: string, fields?: string[]): Promise<RebuildStats>`
- If fields omitted, read from this.options.indexes[type] (same as format operation reads config)
- For each field: call IndexManager.buildIndex() with force=true flag
- Return stats like format operation: { docsScanned, indexesRebuilt, durationMs }

Integration:
- Uses existing IndexManager.buildIndex() method (may need to add force param)
- Follows error handling from ensureIndex: log per-field errors but continue
- Uses atomicWrite pattern (already in IndexManager)

**2. CLI Command (reindex)**
Location: /packages/cli/src/commands/reindex.ts (new file, copy structure from ensure-index.ts)

Pattern to follow: Same as ensure-index command structure
- Register in cli.ts: `program.command('reindex <type> [fields...]')`
- Parse args, open store, call store.rebuildIndexes()
- Display stats: "Rebuilt 3 indexes: status (50 entries), priority (12 entries) in 1.2s"
- Add --all flag to rebuild all indexes for type (reads from config)

## Edge Cases Found in Similar Code

From Store.ensureIndex and Store.format:
1. **Corrupted files:** ensureIndex rebuilds silently if index corrupted, reindex should explicitly delete first
2. **Hidden directories:** format skips .git, reindex should skip when scanning docs
3. **Progress reporting:** format reports every 100 docs for >1k datasets, reindex should match (every 1000 docs for >5k)
4. **Partial failures:** ensureIndex continues if one field fails, reindex should collect errors and continue

## Performance & Observability

From existing index and format operations:
- **Target:** p95 ≤ 2s for 10k docs (matches format operation SLO)
- **Logs:** Add index.rebuild.start/end events in /packages/sdk/src/observability/logs.ts (follows index.build.* pattern)
- **Metrics:** Add index_rebuild_duration_ms in metrics.ts (matches index_build_duration_ms pattern)
- **Progress:** Report progress for datasets > 5k docs (pattern from format)

## Build Order

Based on dependencies I found:
1. First: Check if IndexManager.buildIndex needs force parameter (may already support via delete-then-rebuild)
2. Then: Add Store.rebuildIndexes() - can be built once IndexManager ready
3. Finally: Add CLI command - depends on Store method existing

## Files to Modify

Primary:
- /packages/sdk/src/store.ts - Add rebuildIndexes method
- /packages/sdk/src/indexes.ts - Possibly add force param to buildIndex (or just delete index file first)
- /packages/cli/src/commands/reindex.ts - New command file
- /packages/cli/src/cli.ts - Register command

Supporting:
- /packages/sdk/src/types.ts - Add RebuildStats type
- /packages/sdk/src/observability/logs.ts - Add rebuild events
- /packages/sdk/src/observability/metrics.ts - Add rebuild metric

Tests:
- /packages/sdk/src/store.test.ts - Unit tests for rebuildIndexes
- /packages/cli/test/cli.test.ts - Integration tests for reindex command
```

---

## Key Principle

**Don't guess or assume.** Spend the time to:
1. **Read the actual code** for similar features
2. **Find the patterns** they use
3. **Share what you discovered** and how it should guide this implementation

Your comment is most valuable when it shows "I explored X and found Y, so this feature should follow pattern Z."

