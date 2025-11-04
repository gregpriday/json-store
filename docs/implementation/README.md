# Implementation Documentation

This folder contains all documentation needed to implement JSON Store v0.1.0. **This folder will be deleted after launch** - it's specifically for the implementation phase.

## Quick Start

**New to the project?** Start here:

1. **[BATCHES.md](./BATCHES.md)** - **START HERE** ⭐
   - Defines 5 sequential work batches
   - Shows which issues can be done in parallel
   - Critical path analysis
   - ~2 week timeline with 4 workers

2. **[implementation-plan.md](./implementation-plan.md)** - Project overview
   - All 12 GitHub issues explained
   - Dependency graph
   - Acceptance criteria

3. **[spec.md](./spec.md)** - Full technical specification
   - Complete system design
   - API contracts
   - Performance targets

## Implementation Guides

### For Developers

- **[testing-guide.md](./testing-guide.md)** - How to write tests
  - Vitest best practices
  - Mocking file system operations
  - Integration and E2E patterns
  - Performance benchmarks

- **[git-workflow.md](./git-workflow.md)** - Git and PR process
  - Conventional commits format
  - Atomic commit principles
  - Branch strategy
  - PR workflow

### For Understanding MCP

- **[mcp-primer.md](./mcp-primer.md)** - Model Context Protocol explained
  - What is MCP?
  - How to implement MCP server
  - Tool definitions with examples
  - Testing and debugging
  - Integration with Claude Desktop

## Batch Overview

### Batch 1: Foundation (Days 1-2)

**Start immediately** ✅

- Issue #1: Atomic file I/O
- Issue #2: In-memory cache

**Workers**: 2 parallel

### Batch 2: Core Store (Days 3-4)

**Depends on**: Batch 1

- Issue #3: Store CRUD operations
- Issue #4: Query execution engine

**Workers**: 2 (with some sequencing)

### Batch 3: User Interfaces (Days 5-8)

**Depends on**: Batch 2

- Issue #5: CLI commands
- Issue #6: MCP server
- Issue #7: Equality indexes
- Issue #8: Format operation

**Workers**: 4 parallel

### Batch 4: Polish (Days 8-9)

**Depends on**: Batch 3

- Issue #9: Stats operation
- Integration testing
- Bug fixes

**Workers**: 1-2

### Batch 5: Validation (Days 10-12)

**Depends on**: Batch 4

- Issue #10: E2E integration tests
- Issue #11: Documentation

**Workers**: 4 (2 on tests, 2 on docs)

## File Guide

| File                   | Purpose           | Read When                |
| ---------------------- | ----------------- | ------------------------ |
| **BATCHES.md**         | Work organization | **Before starting work** |
| implementation-plan.md | Project overview  | Planning phase           |
| spec.md                | Technical spec    | Designing features       |
| testing-guide.md       | Testing standards | Writing tests            |
| git-workflow.md        | Git practices     | Making commits           |
| mcp-primer.md          | MCP concepts      | Implementing MCP server  |
| README.md              | This file         | Finding your way         |

## Getting Started with a Batch

1. **Check dependencies**: Is previous batch complete?
2. **Read the issue**: Full details on GitHub
3. **Check the spec**: Technical requirements
4. **Follow testing guide**: Write tests as you go
5. **Use git workflow**: Commit conventions
6. **Sync with team**: Daily standups

## Resources

- **GitHub Issues**: https://github.com/gregpriday/json-store/issues
- **Main README**: [../README.md](../../README.md)
- **Package READMEs**: Check each package folder

## Questions?

1. Check the relevant guide in this folder
2. Check the GitHub issue for that feature
3. Check the main spec.md
4. Ask in team chat / create discussion

## Progress Tracking

See **[implementation-plan.md](./implementation-plan.md)** for:

- Overall progress table
- Dependency graph
- Acceptance criteria

See **Issue #12** for:

- Release checklist
- Completion tracking

## After Launch

**This entire folder will be deleted** after v0.1.0 release.

Permanent documentation will be in:

- `/README.md` - Main README
- `/docs/api-reference.md` - API docs
- `/docs/query-guide.md` - Query language
- `/docs/mcp-tools.md` - MCP tool catalog
- `/docs/operations.md` - Operations guide

---

**Last Updated**: 2025-01-04
**Status**: Ready for implementation - Batch 1 can start immediately
