# Formatting Setup for JSON Store Projects

JSON Store includes a canonical document formatter to ensure clean Git diffs and consistent formatting across platforms. This guide shows how to set up automatic formatting for your JSON Store data.

## Why Format Documents?

The formatter ensures:
- **Byte-stable output**: Identical formatting every time (stable key ordering, consistent line endings)
- **Clean Git diffs**: Formatting changes don't create noise in version control
- **Cross-platform consistency**: LF line endings on all platforms (Windows, macOS, Linux)
- **Idempotent operations**: Re-running the formatter on canonical documents produces no changes

## Manual Formatting

Format documents using the CLI:

```bash
# Format all documents
jsonstore format --all

# Format specific type
jsonstore format task

# Format specific document
jsonstore format task task-001

# Check formatting without writing (CI/CD)
jsonstore format --all --check
```

## Automatic Formatting with Git Hooks

### Pre-commit Hook

Create a pre-commit hook to automatically format documents before each commit:

**File: `.git/hooks/pre-commit`**

```bash
#!/bin/sh
# JSON Store pre-commit hook
# Ensures all documents are canonically formatted before commit

echo "Formatting JSON Store documents..."

# Run format command
npx jsonstore format --all

# Check exit code
if [ $? -ne 0 ]; then
  echo "Error: Failed to format documents"
  exit 1
fi

# Stage any formatting changes
git add data/

exit 0
```

Make the hook executable:

```bash
chmod +x .git/hooks/pre-commit
```

### Alternative: Using Husky

If your project uses [Husky](https://typicode.github.io/husky/), add the format command to your pre-commit hook:

```bash
# Install husky
npm install --save-dev husky
npx husky init

# Add format command to pre-commit
echo "npx jsonstore format --all" >> .husky/pre-commit
echo "git add data/" >> .husky/pre-commit
```

## Enforce Line Endings with .gitattributes

Create a `.gitattributes` file to enforce LF line endings for your data directory:

**File: `.gitattributes`**

```
# Enforce LF line endings for JSON data files to ensure byte-stable formatting
# across platforms (prevents CRLF/LF conversion issues)
data/** text eol=lf
```

This ensures Git always uses LF endings for files in the `data/` directory, regardless of platform settings.

## CI/CD Integration

Use `--check` mode in your CI pipeline to verify formatting:

```yaml
# GitHub Actions example
- name: Check JSON formatting
  run: npx jsonstore format --all --check
```

The command exits with code 1 if any documents need formatting, failing the build.

## Configuration

Formatting behavior is controlled by Store options:

```javascript
import { openStore } from '@jsonstore/sdk';

const store = openStore({
  root: './data',
  indent: 2,                    // Spaces for indentation (default: 2)
  stableKeyOrder: 'alpha',      // Alphabetical key ordering (default: 'alpha')
  formatConcurrency: 16,        // Parallel workers for format operations (default: 16, range: 1-64)
});
```

## Formatting Rules

The canonical formatter applies these rules:

1. **Key Ordering**: Alphabetical by default (or custom order via `stableKeyOrder` array)
2. **Indentation**: Consistent spaces (configurable via `indent` option)
3. **Line Endings**: Always LF (`\n`), never CRLF (`\r\n`) or CR (`\r`)
4. **Trailing Newline**: Single newline at end of file
5. **No Trailing Whitespace**: Clean lines with no extra spaces

## Performance

The formatter uses bounded concurrency to handle large stores efficiently:

- Default: 16 parallel workers
- Range: 1-64 workers (configurable via `formatConcurrency`)
- Memory-efficient: Processes documents in batches
- Fast: Skips documents already in canonical form (byte-stable comparison)

## Troubleshooting

**Problem**: Format command fails with "Invalid JSON" errors

**Solution**: Fix the malformed JSON files. Use `--failFast=false` to see all errors:

```javascript
await store.format({ all: true }, { failFast: false });
```

**Problem**: Pre-commit hook is too slow

**Solution**: Reduce concurrency or format only changed files:

```bash
# Format only specific types that changed
git diff --cached --name-only | grep '^data/task/' && jsonstore format task
```

**Problem**: Windows users still have CRLF in data files

**Solution**: Ensure `.gitattributes` is committed and have users run:

```bash
# Re-normalize all files
git add --renormalize .
git commit -m "Normalize line endings"
```
