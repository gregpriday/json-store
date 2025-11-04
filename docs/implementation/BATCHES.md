# Implementation Batches for JSON Store

This document defines sequential batches of work optimized for parallel execution. Each batch contains up to 4 tasks that can be worked on simultaneously.

## Overview

- **Total Issues**: 11 implementation issues (#1-11, #12 is meta-tracking)
- **Total Batches**: 5 batches
- **Timeline**: ~2 weeks with 4 parallel workers

## Critical Path Analysis

```
Critical Path (Longest):
#1 (I/O) → #2 (Cache) → #3 (CRUD) → #4 (Query) → #7 (Indexes) → #10 (E2E) → #11 (Docs)

Parallel Branches:
- #5 (CLI) can start after #3, #4
- #6 (MCP) can start after #3, #4
- #8 (Format) can start after #3
- #9 (Stats) can start after #3
```

---

## Batch 1: Foundation (Days 1-2)

**Goal**: Establish core infrastructure

**Can start immediately** ✅

### Issues in Batch 1

| Issue | Title | Assignable To | Estimated Time |
|-------|-------|---------------|----------------|
| **#1** | Implement atomic file I/O operations | Agent A | 1-2 days |
| **#2** | Implement in-memory document cache | Agent B | 1-2 days |

### Why These Together?

- **No dependencies**: Both can start immediately
- **Different concerns**: I/O vs caching, minimal overlap
- **Foundation**: Both required for everything else
- **Only 2 tasks**: Allows focused work on critical infrastructure

### Completion Criteria

- [ ] Atomic write operations work (write-rename-sync)
- [ ] Cache invalidates correctly on mtime/size change
- [ ] All unit tests pass
- [ ] Integration tests with real filesystem pass

### Blockers for Next Batch

Next batch cannot start until:
- ✅ Atomic write functions exported and tested
- ✅ Cache class exported and tested

---

## Batch 2: Core Store (Days 3-4)

**Goal**: Implement complete CRUD and query functionality

**Depends on**: Batch 1 complete

### Issues in Batch 2

| Issue | Title | Assignable To | Estimated Time |
|-------|-------|---------------|----------------|
| **#3** | Implement complete Store CRUD operations | Agent A | 2 days |
| **#4** | Implement query execution engine | Agent B | 2 days |

### Why These Together?

- **Sequential dependency**: #4 needs #3 complete (uses Store.list internally)
- **2 tasks only**: Complex implementations need focus
- **Critical path**: Both are on the longest path to completion
- **Integration point**: They integrate together (query uses get/list)

### Suggested Workflow

**Day 3**:
- Agent A: Implement put/get/remove/list
- Agent B: Start query operator implementation (can work in isolation)

**Day 4**:
- Agent A: Finish Store integration, add git support
- Agent B: Integrate query with Store (needs #3 complete)

### Completion Criteria

- [ ] All CRUD operations functional
- [ ] Query engine supports all Mango operators
- [ ] Cache properly integrated
- [ ] Formatting is byte-stable
- [ ] All tests pass (>90% coverage)

### Blockers for Next Batch

Next batch cannot start until:
- ✅ Store.put/get/remove/list all work
- ✅ Store.query returns correct results

---

## Batch 3: User Interfaces (Days 5-8)

**Goal**: Implement all user-facing interfaces and enhancements

**Depends on**: Batch 2 complete

### Issues in Batch 3

| Issue | Title | Assignable To | Estimated Time |
|-------|-------|---------------|----------------|
| **#5** | Implement CLI commands with Commander.js | Agent A | 2 days |
| **#6** | Implement MCP server with stdio transport | Agent B | 2 days |
| **#7** | Implement equality indexes | Agent C | 2 days |
| **#8** | Implement format operation | Agent D | 1 day |

### Why These Together?

- **All depend on #3, #4**: All need working CRUD and query
- **Independent work**: Minimal overlap between tasks
- **Different skills**: CLI, MCP, performance, operations
- **Parallel work**: Can genuinely work simultaneously

### Suggested Assignments

**Agent A (CLI)**:
- Familiar with Commander.js
- Focus on UX and error handling
- Test with real filesystem

**Agent B (MCP)**:
- Familiar with MCP/Zod
- Focus on tool schemas and validation
- Test with MCP inspector

**Agent C (Indexes)**:
- Focus on performance optimization
- Implement sidecar JSON files
- Benchmark tests critical

**Agent D (Format)**:
- Simpler task, can finish in 1 day
- Then help with testing or move to #9

### Completion Criteria

- [ ] All CLI commands work correctly
- [ ] MCP server handles all 6 tools
- [ ] Indexes provide 10x+ speedup
- [ ] Format is byte-stable and idempotent
- [ ] All tests pass
- [ ] MCP server works with Claude Desktop

### Blockers for Next Batch

Next batch cannot start until:
- ✅ CLI can be used for all operations
- ✅ MCP server functional
- ✅ Indexes improve performance
- ✅ Format works correctly

---

## Batch 4: Polish & Stats (Days 8-9)

**Goal**: Add final SDK features before comprehensive testing

**Depends on**: Batch 3 complete

### Issues in Batch 4

| Issue | Title | Assignable To | Estimated Time |
|-------|-------|---------------|----------------|
| **#9** | Implement stats operation | Agent A or D | 1 day |

### Why Only One Issue?

- **Simple task**: Stats is straightforward
- **Buffer time**: Allows catching up on Batch 3 if needed
- **Preparation**: Get ready for comprehensive E2E testing
- **Bug fixes**: Time to address issues found in Batch 3

### Activities During Batch 4

1. **Implement stats** (Agent A)
2. **Integration testing** (All agents)
3. **Bug fixes** from Batch 3
4. **Performance optimization**
5. **Prepare E2E test data**

### Completion Criteria

- [ ] Stats accurately counts documents and bytes
- [ ] All previous batch issues are truly complete
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Performance benchmarks meet targets

### Blockers for Next Batch

Next batch cannot start until:
- ✅ All SDK functionality complete
- ✅ All packages build successfully
- ✅ No known bugs

---

## Batch 5: Validation & Documentation (Days 10-12)

**Goal**: Comprehensive testing and complete documentation

**Depends on**: All previous batches complete

### Issues in Batch 5

| Issue | Title | Assignable To | Estimated Time |
|-------|-------|---------------|----------------|
| **#10** | Add end-to-end integration tests | Agent A + Agent B | 2 days |
| **#11** | Create comprehensive documentation | Agent C + Agent D | 2 days |

### Why These Together?

- **Final validation**: E2E tests validate everything works together
- **Independent work**: Testing and docs can be parallel
- **Quality focus**: Both about ensuring quality and usability
- **Allows flexibility**: 2 agents on each task for coverage

### Task Breakdown

**E2E Tests (Agents A + B)**:
- Agent A: SDK and CLI E2E tests
- Agent B: MCP server integration tests
- Both: Performance benchmarks

**Documentation (Agents C + D)**:
- Agent C: API reference, query guide, examples
- Agent D: MCP tools, operations runbook, troubleshooting

### Completion Criteria

- [ ] Full workflow E2E tests pass
- [ ] Performance benchmarks meet all targets:
  - 1000 docs cold: <150ms ✅
  - 1000 docs warm: <30ms ✅
  - Indexed query: <10ms ✅
- [ ] All documentation complete
- [ ] Examples tested and working
- [ ] README is comprehensive

### Release Readiness

After Batch 5:
- ✅ All functionality implemented
- ✅ All tests passing
- ✅ Documentation complete
- ✅ Ready for v0.1.0 release

---

## Batch Summary Table

| Batch | Days | Issues | Can Start | Must Complete |
|-------|------|--------|-----------|---------------|
| **1** | 1-2 | #1, #2 | Immediately | Before Batch 2 |
| **2** | 3-4 | #3, #4 | After Batch 1 | Before Batch 3 |
| **3** | 5-8 | #5, #6, #7, #8 | After Batch 2 | Before Batch 4 |
| **4** | 8-9 | #9 | After Batch 3 | Before Batch 5 |
| **5** | 10-12 | #10, #11 | After Batch 4 | For release |

## Parallelization Strategy

### Maximum Parallelization

- **Batch 1**: 2 parallel workers
- **Batch 2**: 2 parallel workers (with some sequencing)
- **Batch 3**: 4 parallel workers (full parallelization)
- **Batch 4**: 1-2 workers (cleanup + stats)
- **Batch 5**: 4 workers (2 on tests, 2 on docs)

### Resource Allocation

**Optimal team size**: 4 contributors

**Skill requirements per batch**:

| Batch | Skills Needed |
|-------|---------------|
| 1 | Node.js file I/O, caching patterns |
| 2 | TypeScript, data structures, algorithms |
| 3 | CLI tools, MCP/Zod, performance optimization |
| 4 | General TypeScript |
| 5 | Testing frameworks, technical writing |

## Risk Mitigation

### What if Batch 1 takes longer?

- **Impact**: Delays everything
- **Mitigation**: Start Batch 1 with most experienced developers
- **Buffer**: Can compress Batch 4 (stats is simple)

### What if Batch 3 has delays?

- **Impact**: Moderate - delays final stages
- **Mitigation**:
  - Focus on critical path: #5 and #7
  - #6 (MCP) can slip slightly
  - #8 (Format) is simple, can be done quickly

### What if we find major bugs in Batch 5?

- **Impact**: Could delay release
- **Mitigation**:
  - Good unit tests in earlier batches
  - Integration tests in Batch 4
  - Budget extra time in Batch 5

## Communication Points

### End of Each Batch

**Sync meeting** to:
1. Demo completed work
2. Review test coverage
3. Identify blockers for next batch
4. Assign tasks for next batch

### Daily (Within Batch)

**Quick standup** to:
1. Share progress
2. Identify integration points
3. Resolve dependencies
4. Help unblock others

## Success Metrics

### Batch 1
- ✅ Zero data loss in atomic write tests
- ✅ Cache hit rate >80% in benchmarks

### Batch 2
- ✅ All CRUD operations <10ms
- ✅ Query correctness: 100% test pass rate

### Batch 3
- ✅ CLI commands all functional
- ✅ MCP server works with Claude Desktop
- ✅ Indexed queries 10x faster

### Batch 4
- ✅ All integration tests passing
- ✅ No known bugs

### Batch 5
- ✅ E2E tests cover all workflows
- ✅ Documentation is clear and complete
- ✅ Ready for external users

## Next Steps

1. **Assign Batch 1** immediately:
   - Agent A → Issue #1 (Atomic I/O)
   - Agent B → Issue #2 (Cache)

2. **Set up project board** with columns:
   - Backlog
   - Batch 1 (In Progress)
   - Batch 2 (Blocked)
   - Batch 3 (Blocked)
   - Batch 4 (Blocked)
   - Batch 5 (Blocked)
   - Done

3. **Schedule kick-off** for Batch 1

4. **Plan Batch 2** assignment during Batch 1

---

**Last Updated**: 2025-01-04
**Status**: Ready to Start - Batch 1 Can Begin Immediately
