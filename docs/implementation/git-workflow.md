# Git Workflow Guide

This guide defines Git practices for JSON Store development.

## Commit Message Format

We use **Conventional Commits** for all commit messages.

### Structure

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Purpose                             | SemVer Impact         |
| ---------- | ----------------------------------- | --------------------- |
| `feat`     | New feature                         | MINOR (0.1.0 → 0.2.0) |
| `fix`      | Bug fix                             | PATCH (0.1.0 → 0.1.1) |
| `refactor` | Code change (no bug fix or feature) | None                  |
| `perf`     | Performance improvement             | PATCH                 |
| `test`     | Add/update tests                    | None                  |
| `docs`     | Documentation only                  | None                  |
| `chore`    | Maintenance (deps, build, etc.)     | None                  |
| `style`    | Code style/formatting               | None                  |

### Scopes

Common scopes for JSON Store:

- `sdk` - SDK package
- `cli` - CLI package
- `server` - MCP server package
- `cache` - Caching layer
- `io` - File I/O operations
- `query` - Query engine
- `index` - Indexing system

### Examples

**Good commits:**

```
feat(sdk): add atomic write operations with fsync

Implements the write-rename-sync pattern for crash-safe file writes.
Uses temp files in same directory to ensure atomic rename works.

- Write to .{filename}.{uuid}.tmp
- fsync temp file
- Rename to target
- fsync parent directory

Closes #1
```

```
fix(query): handle null values in $eq comparisons

Previously, null values would cause incorrect matches.
Now explicitly checks for null and compares correctly.

Fixes #42
```

```
test(cache): add invalidation tests for mtime changes
```

```
docs: update API reference with cache options
```

```
chore(deps): update vitest to v1.2.0
```

**Breaking changes:**

```
feat(sdk)!: change Store constructor to accept options object

BREAKING CHANGE: The Store constructor now requires an options object
instead of a simple string path.

Before: new Store('./data')
After: new Store({ root: './data' })
```

## Atomic Commits

**Rule**: One commit = One logical change

### ✅ Good (Atomic)

```bash
# Commit 1: Refactor only
git commit -m "refactor(io): extract file path helpers to separate module"

# Commit 2: Feature using refactored code
git commit -m "feat(io): add atomic write with fsync"
```

### ❌ Bad (Non-Atomic)

```bash
# Mixed concerns in one commit
git commit -m "feat: add atomic write and fix formatting and update deps"
```

## Staging Strategies

### Stage Partial Changes

```bash
# Interactive staging for atomic commits
git add -p file.ts

# Choose hunks that belong to one logical change
# 'y' to stage, 'n' to skip, 's' to split
```

### Stash Work-in-Progress

```bash
# Stash unfinished work to fix urgent bug
git stash push -m "WIP: half-finished index implementation"

# Fix bug atomically
git add bug-fix.ts
git commit -m "fix(query): resolve null pointer in filter evaluation"

# Resume WIP
git stash pop
```

## Branch Strategy

### Main Branch

- Always deployable
- All tests must pass
- Protected - requires PR review

### Feature Branches

```bash
# Create feature branch from main
git checkout -b feat/atomic-io

# Work on feature with atomic commits
git commit -m "feat(io): add temp file generation"
git commit -m "feat(io): implement fsync wrapper"
git commit -m "test(io): add atomic write tests"

# Push to remote
git push -u origin feat/atomic-io

# Create PR when ready
```

### Branch Naming

```
<type>/<short-description>

Examples:
feat/atomic-io
fix/cache-invalidation
refactor/query-engine
docs/api-reference
test/e2e-workflows
```

## Pull Request Workflow

### Before Creating PR

```bash
# Ensure all tests pass
pnpm test

# Ensure types are correct
pnpm typecheck

# Ensure build works
pnpm build

# Format code
pnpm format

# Rebase on latest main
git fetch origin
git rebase origin/main

# Fix any conflicts, then continue
git rebase --continue
```

### Interactive Rebase for Clean History

```bash
# Clean up commits before PR
git rebase -i origin/main

# In editor:
# - 'pick' commits to keep as-is
# - 'squash' to combine with previous
# - 'reword' to change message
# - 'drop' to remove commit
```

**Example:**

```
pick abc1234 feat(io): add temp file generation
squash def5678 fix typo
squash ghi9012 oops forgot file
pick jkl3456 feat(io): implement fsync wrapper
pick mno7890 test(io): add atomic write tests
```

Becomes:

```
feat(io): add temp file generation
feat(io): implement fsync wrapper
test(io): add atomic write tests
```

### PR Title Format

Use conventional commit format:

```
feat(sdk): implement atomic file I/O operations
```

### PR Description Template

```markdown
## Summary

Brief description of what this PR does.

## Changes

- Bullet point list of changes
- Keep it concise

## Testing

- [ ] Unit tests added
- [ ] Integration tests added
- [ ] Manual testing completed

## Related Issues

Closes #1
```

## Reviewing PRs

### For Reviewers

- Check commit messages follow conventions
- Verify tests are included
- Ensure atomic commits
- Run tests locally if unsure
- Check for breaking changes

### Review Comments

```bash
# Request changes
Please split this into atomic commits - the formatting
changes should be separate from the feature addition.

# Approve
LGTM! Clean atomic commits and good test coverage.
```

## Merging Strategy

### Squash and Merge (Preferred)

- All commits squashed into one
- Use conventional commit format for merge commit
- Clean history on main branch

```
feat(sdk): implement atomic file I/O operations (#1)

* Add atomic write with fsync
* Add tests for concurrent writes
* Update documentation
```

### Rebase and Merge (For Clean PRs)

- Only if PR has clean, atomic commits
- Preserves individual commits
- Creates linear history

## Reverting Changes

```bash
# Revert a specific commit
git revert abc1234

# Revert a merge commit
git revert -m 1 merge-commit-sha

# Commit message for revert
git commit -m "revert: remove atomic IO (breaks on Windows)

This reverts commit abc1234.

Reason: fsync behavior differs on Windows, causing data loss.
Will reimplement with platform detection."
```

## Tagging Releases

```bash
# Create annotated tag
git tag -a v0.1.0 -m "Release version 0.1.0"

# Push tag to remote
git push origin v0.1.0

# Tag message format
Release version 0.1.0

Features:
- Atomic file I/O
- Mango query engine
- CLI commands
- MCP server

Bug fixes:
- Cache invalidation on write
- Null handling in queries
```

## Pre-commit Hooks

### Install Hooks

```bash
# Using Husky
pnpm add -D husky
npx husky init

# Add pre-commit hook
echo "pnpm test" > .husky/pre-commit
echo "pnpm typecheck" >> .husky/pre-commit
chmod +x .husky/pre-commit
```

### Bypass Hooks (When Necessary)

```bash
# Skip pre-commit hook (use sparingly!)
git commit --no-verify -m "WIP: work in progress"
```

## Common Workflows

### Fix Bug in Production

```bash
# Create hotfix branch from main
git checkout -b fix/critical-bug main

# Fix and test
git commit -m "fix(query): prevent null pointer exception"

# Create PR and merge immediately
# Tag new patch version
git tag -a v0.1.2 -m "Hotfix: null pointer in query"
```

### Add Feature

```bash
# Feature branch
git checkout -b feat/new-feature main

# Develop with atomic commits
git commit -m "feat(sdk): add new feature foundation"
git commit -m "feat(sdk): implement core logic"
git commit -m "test(sdk): add feature tests"
git commit -m "docs: document new feature"

# PR and merge
```

### Refactor Code

```bash
# Refactor branch
git checkout -b refactor/query-engine main

# Each refactor step is atomic
git commit -m "refactor(query): extract operator evaluation"
git commit -m "refactor(query): simplify filter logic"
git commit -m "test(query): ensure behavior unchanged"
```

## Best Practices

1. **Commit often** - Small, atomic commits
2. **Test before commit** - Ensure tests pass
3. **Write clear messages** - Future you will thank you
4. **Review your own PR** - Catch issues before reviewers
5. **Keep main clean** - Always deployable
6. **Tag releases** - Semantic versioning
7. **Document breaking changes** - In commit body and PR

## Tools

```bash
# Check commit message format
npx commitlint --edit

# Format code before commit
pnpm format

# Run all checks
pnpm test && pnpm typecheck && pnpm build
```
