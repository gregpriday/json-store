# Operations Runbook

Practical guide for managing a JSON Store in production.

## Setup

### Initialize Store

```bash
# Create data directory
mkdir -p ./data

# Initialize with CLI (if available)
jsonstore init --dir ./data

# Or manually create structure
mkdir -p ./data/_meta
echo '{"indent":2,"stableKeyOrder":"alpha"}' > ./data/_meta/store.config.json
```

### Configure Git

```bash
cd data
git init
git add .
git commit -m "chore: initialize JSON Store"

# Add remote (optional)
git remote add origin <your-repo-url>
git push -u origin main
```

### Setup .gitignore

```bash
# In data/.gitignore
*.tmp
*.lock
_indexes/*.tmp
```

## Maintenance

### Format All Documents

Ensure consistent formatting across all documents:

```bash
# Format all documents
jsonstore format --all

# Format specific type
jsonstore format --type task

# Commit formatted changes
cd data && git add . && git commit -m "chore: reformat documents"
```

### Create Performance Indexes

Index frequently queried fields:

```bash
# Index task fields
jsonstore ensure-index task status
jsonstore ensure-index task priority
jsonstore ensure-index task assignee

# Index user fields
jsonstore ensure-index user email
jsonstore ensure-index user status
```

### Monitor Store Size

```bash
# Get overall stats
jsonstore stats

# Stats for specific type
jsonstore stats --type task

# Check disk usage
du -sh ./data
du -sh ./data/*
```

### Backup and Restore

#### Manual Backup

```bash
# Create timestamped backup
tar -czf data-backup-$(date +%Y%m%d-%H%M%S).tar.gz data/

# Or use rsync
rsync -av --delete data/ backup/data/
```

#### Git-based Backup

```bash
# Push to remote
cd data && git push origin main

# Tag important states
cd data && git tag -a v1.0.0 -m "Release 1.0.0" && git push --tags
```

#### Restore from Backup

```bash
# From tarball
tar -xzf data-backup-20250104-120000.tar.gz

# From git
git clone <repo-url> data
cd data && git checkout <tag-or-commit>
```

## Troubleshooting

### Corrupted JSON File

**Symptom**: Parse errors when reading document

**Solution**:

```bash
# Validate JSON
cat data/task/task-1.json | jq .

# If invalid, restore from git
cd data
git checkout HEAD -- task/task-1.json

# Or restore from backup
cp backup/data/task/task-1.json data/task/task-1.json
```

### Performance Issues

**Symptom**: Slow queries

**Diagnosis**:

```bash
# Check document count
jsonstore stats

# Check index status
ls -la data/task/_indexes/

# Enable debug logging
export JSONSTORE_DEBUG=1
```

**Solutions**:

1. **Create indexes** for frequently queried fields
2. **Reduce document count** per type (consider sharding)
3. **Optimize queries** - always specify `type`, use `limit`
4. **Increase cache size** - set `JSONSTORE_CACHE_SIZE=50000`

### Merge Conflicts

**Symptom**: Git merge conflicts in JSON files

**Prevention**:

```bash
# Always pull before making changes
cd data && git pull

# Use git attributes for better diffs
echo "*.json diff=json" >> data/.gitattributes
```

**Resolution**:

```bash
# Manual resolution
cd data
git status  # See conflicting files

# Edit conflict markers in JSON files
# Ensure valid JSON after resolution
cat data/task/task-1.json | jq .

# Mark as resolved
git add data/task/task-1.json
git commit
```

**Automatic reformat after conflict**:

```bash
# After resolving conflicts
jsonstore format --all
cd data && git add . && git commit --amend --no-edit
```

### Stale Index Data

**Symptom**: Query returns incorrect results

**Solution**:

```bash
# Rebuild specific index
jsonstore ensure-index task status

# Rebuild all indexes for type
jsonstore ensure-index task status
jsonstore ensure-index task priority
# ... (repeat for all indexed fields)

# Or delete and recreate
rm -rf data/task/_indexes/
jsonstore ensure-index task status
jsonstore ensure-index task priority
```

### Cache Inconsistency

**Symptom**: Reading stale data after external writes

**Solution**:

```bash
# Disable cache temporarily
export JSONSTORE_CACHE_SIZE=0

# Or restart application to clear cache
```

### Disk Space Issues

**Symptom**: Running out of disk space

**Analysis**:

```bash
# Find largest types
du -sh data/*/ | sort -h

# Find large documents
find data -name "*.json" -size +100k -ls
```

**Solutions**:

1. **Archive old data**:

   ```bash
   # Move closed tasks to archive
   mkdir -p archive/task
   mv data/task/old-*.json archive/task/
   ```

2. **Compress with git**:

   ```bash
   cd data
   git gc --aggressive --prune=now
   ```

3. **Split large types**:
   ```bash
   # Move to separate store
   mkdir -p data-archive
   mv data/task-archive data-archive/task
   ```

## Git Workflows

### Pre-commit Hook

Create `.git/hooks/pre-commit` in data directory:

```bash
#!/bin/bash
# Validate all JSON files before commit

for file in $(git diff --cached --name-only --diff-filter=ACM | grep '\.json$'); do
  if ! jq empty "$file" 2>/dev/null; then
    echo "Error: Invalid JSON in $file"
    exit 1
  fi
done

exit 0
```

```bash
chmod +x data/.git/hooks/pre-commit
```

### Conventional Commits

Use consistent commit messages:

```bash
# Feature additions
git commit -m "feat(task): add new task task-123"

# Updates
git commit -m "chore(task): update task-123 status"

# Removals
git commit -m "chore(task): remove completed task-123"

# Formatting
git commit -m "chore: reformat all documents"

# Index maintenance
git commit -m "chore(index): rebuild task status index"
```

### Branch Strategy

```bash
# Main branch for production
git checkout main

# Develop branch for changes
git checkout -b develop

# Feature branches for experiments
git checkout -b feature/add-user-fields

# Merge back to develop
git checkout develop
git merge feature/add-user-fields

# Deploy to main
git checkout main
git merge develop
```

## Capacity Planning

### Document Limits

**Recommended limits per type**:

- **Optimal**: ≤10,000 documents
- **Acceptable**: 10,000-25,000 documents
- **Consider sharding**: >25,000 documents

### Document Size

**Recommended document sizes**:

- **Optimal**: ≤10 KB per document
- **Acceptable**: 10-100 KB per document
- **Avoid**: >100 KB per document (consider splitting)

### Total Store Size

**Recommended total sizes**:

- **Optimal**: ≤500 MB
- **Acceptable**: 500 MB - 2 GB
- **Consider alternatives**: >2 GB

### Sharding Strategy

When approaching limits, shard by prefix:

```bash
# Original structure
data/task/*.json  # 50,000 tasks

# Sharded structure
data/task-a/*.json  # A-C
data/task-d/*.json  # D-M
data/task-n/*.json  # N-Z
```

Or shard by date:

```bash
data/task-2024/*.json
data/task-2025/*.json
```

## Monitoring

### Health Checks

```bash
#!/bin/bash
# health-check.sh - Run periodically

# Check store accessible
if [ ! -d "./data" ]; then
  echo "ERROR: Data directory not found"
  exit 1
fi

# Check document count
COUNT=$(find data -name "*.json" -not -path "*/\_*" | wc -l)
echo "Documents: $COUNT"

# Check disk usage
USAGE=$(du -sh data | cut -f1)
echo "Disk usage: $USAGE"

# Check git status
cd data
if [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: Uncommitted changes"
fi

# Check JSON validity
INVALID=$(find . -name "*.json" -not -path "*/\_*" -exec sh -c 'jq empty {} 2>/dev/null || echo {}' \; | wc -l)
if [ "$INVALID" -gt 0 ]; then
  echo "ERROR: $INVALID invalid JSON files"
fi
```

### Performance Monitoring

```bash
# Monitor query performance
export JSONSTORE_DEBUG=1

# Logs will show:
# - Query duration
# - Index usage
# - Result count
```

### Alerting

Set up alerts for:

- Disk usage >80%
- Document count per type >20,000
- Query duration >5s
- Invalid JSON files detected
- Uncommitted changes >24h old

## Security

### Path Validation

JSON Store validates all paths to prevent traversal attacks. Always use the SDK - never manipulate files directly unless necessary.

### Access Control

```bash
# Restrict data directory permissions
chmod 750 data/
chown -R app:app data/

# Restrict MCP server
# Only bind to localhost in production
```

### Backup Encryption

```bash
# Encrypt backups
tar -czf - data/ | gpg --encrypt --recipient user@example.com > backup.tar.gz.gpg

# Decrypt
gpg --decrypt backup.tar.gz.gpg | tar -xzf -
```

## CLI Reference

### Common Commands

```bash
# Initialize store
jsonstore init --dir ./data

# CRUD operations
jsonstore put task task-1 --data '{"type":"task","id":"task-1","title":"Fix"}'
jsonstore get task task-1
jsonstore delete task task-1

# List operations
jsonstore ls task
jsonstore ls task --limit 100

# Query
jsonstore query --type task --data '{"filter":{"status":"open"}}'

# Format operations
jsonstore format --all
jsonstore format --type task
jsonstore format task task-1

# Index operations
jsonstore ensure-index task status
jsonstore ensure-index task priority

# Stats
jsonstore stats
jsonstore stats --type task
```

## Best Practices

### Do

✅ Always specify `type` in queries for better performance
✅ Use indexes for frequently queried fields
✅ Set reasonable `limit` on queries
✅ Commit changes to git regularly
✅ Validate JSON before committing
✅ Format documents consistently
✅ Monitor disk usage and document counts
✅ Test restores from backups periodically
✅ Use meaningful commit messages
✅ Keep documents under 100 KB

### Don't

❌ Don't edit JSON files manually (use SDK/CLI)
❌ Don't commit invalid JSON
❌ Don't skip backups
❌ Don't ignore performance warnings
❌ Don't exceed recommended document counts
❌ Don't store large binary data in documents
❌ Don't use the store for high-write-throughput scenarios
❌ Don't expose data directory directly via web server
❌ Don't ignore disk space warnings
❌ Don't hardcode absolute paths

## Emergency Procedures

### Data Corruption

1. **Stop application** immediately
2. **Backup current state** (even if corrupt)
3. **Restore from last known good backup**
4. **Validate restored data**
5. **Identify corruption cause** before resuming

### Performance Degradation

1. **Enable debug logging** (`JSONSTORE_DEBUG=1`)
2. **Check query patterns** for missing indexes
3. **Review document counts** per type
4. **Create missing indexes**
5. **Consider sharding** if limits exceeded

### Unexpected Behavior

1. **Check git status** for uncommitted changes
2. **Validate JSON** files for corruption
3. **Rebuild indexes** if query results incorrect
4. **Clear cache** and restart application
5. **Review recent commits** for breaking changes
