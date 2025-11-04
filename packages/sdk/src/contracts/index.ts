/**
 * Index contracts and invariants
 */

/**
 * Index specification
 */
export interface IndexSpec {
  /** Entity type */
  type: string;
  /** Field name to index */
  field: string;
}

/**
 * Index invariants:
 *
 * 1. Index lifecycle:
 *    - ensureIndex() is idempotent - can be called multiple times safely
 *    - Indexes are built lazily on first ensureIndex() call
 *    - Indexes are persisted in _indexes/ directory
 *    - Indexes survive store close/reopen
 *
 * 2. Index structure:
 *    - Stored as JSON file: <type>/_indexes/<field>.json
 *    - Format: { "<value>": ["<id1>", "<id2>", ...] }
 *    - Only equality lookups are indexed
 *
 * 3. Index maintenance:
 *    - Indexes are updated synchronously on put()
 *    - Indexes are updated synchronously on remove()
 *    - rebuildIndexes() reconstructs from scratch
 *
 * 4. Query optimization:
 *    - Simple equality queries use index: { field: { $eq: value } }
 *    - Complex queries fall back to full scan
 *    - Index lookup should be <10ms (SLO)
 */

/**
 * Index file format
 */
export type IndexFile = Record<string, string[]>;
