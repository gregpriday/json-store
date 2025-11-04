/**
 * Query DSL contracts and invariants
 * This module defines the canonical query language operators and semantics
 */

import type { LogicalOperator as LogicalOperatorShape } from "../types.js";

/**
 * Explicit Mango query operators
 * All operators must be prefixed with $ to avoid ambiguity
 */
export type QueryOperator =
  | "$eq" // Equality: field === value (or value in array for array fields)
  | "$ne" // Not equal: field !== value
  | "$in" // In array: value in [...]
  | "$nin" // Not in array: value not in [...]
  | "$gt" // Greater than: field > value
  | "$gte" // Greater than or equal: field >= value
  | "$lt" // Less than: field < value
  | "$lte" // Less than or equal: field <= value
  | "$exists" // Field exists: field !== undefined
  | "$type"; // Type check: typeof field === value

/**
 * Logical operators for combining conditions
 */
export type LogicalOperator = LogicalOperatorShape;

/**
 * Query semantics and invariants:
 *
 * 1. Filter semantics:
 *    - Empty filter {} matches all documents
 *    - All top-level conditions are implicitly AND-ed
 *    - Operators are case-sensitive and must start with $
 *    - Unknown operators throw an error
 *
 * 2. Sort semantics:
 *    - 1 = ascending, -1 = descending
 *    - Multiple fields are applied in order (stable sort)
 *    - Null/undefined values sort first
 *    - Mixed types use precedence: null < boolean < number < string < object
 *
 * 3. Projection semantics:
 *    - 1 = include field, 0 = exclude field
 *    - Cannot mix inclusion and exclusion
 *    - Missing fields are silently omitted from result
 *    - Dot-path fields are flattened in result
 *
 * 4. Query execution order:
 *    - 1. Filter (applies to all documents)
 *    - 2. Sort (applies to filtered results)
 *    - 3. Skip/Limit (pagination on sorted results)
 *    - 4. Projection (applied last to minimize work)
 *
 * 5. Index semantics:
 *    - Indexes are per-type equality lookups
 *    - Only $eq queries on indexed fields use the index
 *    - Complex queries fall back to full scan
 *    - Indexes are persisted and survive store reopens
 */

/**
 * Query performance contracts (SLOs):
 * - 1000 docs cold query: <150ms
 * - 1000 docs warm (cached): <30ms
 * - 10000 docs cold query: <1500ms
 * - 10000 docs warm (cached): <300ms
 * - Indexed equality query: <10ms (1k docs), <50ms (10k docs)
 * - Single document write: <10ms
 * - Batch write (10 docs): <100ms
 */
export const QUERY_SLO = {
  COLD_QUERY_1K_MS: 150,
  WARM_QUERY_1K_MS: 30,
  COLD_QUERY_10K_MS: 1500,
  WARM_QUERY_10K_MS: 300,
  INDEXED_QUERY_MS: 10,
  INDEXED_QUERY_10K_MS: 50,
  SINGLE_WRITE_MS: 10,
  BATCH_WRITE_10_MS: 100,
} as const;
