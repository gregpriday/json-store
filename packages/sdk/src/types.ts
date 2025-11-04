/**
 * Core types for JSON Store
 */

/**
 * Configuration options for opening a store
 */
export interface StoreOptions {
  /** Root directory for the data store (e.g., ./data) */
  root: string;
  /** Number of spaces for JSON indentation (default: 2) */
  indent?: number;
  /** Key ordering strategy: "alpha" for alphabetical, or array for explicit order */
  stableKeyOrder?: "alpha" | string[];
  /** Enable file system watching to refresh caches (optional) */
  watch?: boolean;
  /** Enable equality indexes for fast query execution (default: false) */
  enableIndexes?: boolean;
  /** Fields to index per type: { type: [field1, field2] } */
  indexes?: Record<string, string[]>;
  /** Maximum concurrency for format operations (default: 16, range: 1-64) */
  formatConcurrency?: number;
}

/**
 * Document key identifying a unique entity
 */
export interface Key {
  /** Entity type (maps to folder name) */
  type: string;
  /** Entity ID (maps to filename without .json) */
  id: string;
}

/**
 * Base document structure - all documents must include type and id
 */
export type Document = Record<string, unknown> & {
  type: string;
  id: string;
};

/**
 * Mango query operators for field-level conditions
 */
export type FieldOperator =
  | { $eq: any }
  | { $ne: any }
  | { $in: any[] }
  | { $nin: any[] }
  | { $gt: any }
  | { $gte: any }
  | { $lt: any }
  | { $lte: any }
  | { $exists: boolean }
  | { $type: string };

/**
 * Logical operators for combining conditions
 */
export type LogicalOperator = { $and: Filter[] } | { $or: Filter[] } | { $not: Filter };

/**
 * Filter object for Mango queries
 * Can be field conditions, logical operators, or combinations
 */
export type Filter = Record<string, any> | LogicalOperator;

/**
 * Projection specification (1 = include field, 0 = exclude field)
 */
export type Projection = Record<string, 0 | 1>;

/**
 * Sort specification (1 = ascending, -1 = descending)
 */
export type Sort = Record<string, 1 | -1>;

/**
 * Complete query specification for finding documents
 */
export interface QuerySpec {
  /** Restrict query to a specific type (optional) */
  type?: string;
  /** Filter conditions using Mango query language */
  filter: Filter;
  /** Fields to include/exclude in results (optional) */
  projection?: Projection;
  /** Sort order for results (optional) */
  sort?: Sort;
  /** Maximum number of results to return (optional) */
  limit?: number;
  /** Number of results to skip (for pagination, optional) */
  skip?: number;
}

/**
 * Options for write operations
 */
export interface WriteOptions {
  /** Optional git commit message (if git integration enabled) */
  gitCommit?: string;
  /** Optional batch identifier for grouping commits */
  gitBatch?: string;
}

/**
 * Options for remove operations
 */
export interface RemoveOptions {
  /** Optional git commit message (if git integration enabled) */
  gitCommit?: string;
}

/**
 * Statistics for a type or entire store
 */
export interface StoreStats {
  /** Number of documents */
  count: number;
  /** Total size in bytes */
  bytes: number;
}

/**
 * Target for format operation
 */
export type FormatTarget = { all: true } | { type: string; id?: string };

/**
 * Canonical formatting options
 */
export interface CanonicalOptions {
  /** Number of spaces for indentation */
  indent: number;
  /** Whether to use stable key ordering */
  stableKeyOrder: boolean | string[];
  /** End-of-line character (LF or CRLF) */
  eol: "LF" | "CRLF";
  /** Whether to add trailing newline */
  trailingNewline: boolean;
}

/**
 * Format operation options
 */
export interface FormatOptions {
  /** Dry run mode - check formatting without writing (default: false) */
  dryRun?: boolean;
  /** Fail fast on first error (default: false, continues on errors) */
  failFast?: boolean;
}

/**
 * Main store interface
 */
export interface Store {
  /**
   * Store or update a document
   * @param key - Document key (type and id)
   * @param doc - Document to store (must include type and id matching key)
   * @param opts - Optional write options (git commit, batch, etc.)
   */
  put(key: Key, doc: Document, opts?: WriteOptions): Promise<void>;

  /**
   * Retrieve a document by key
   * @param key - Document key (type and id)
   * @returns Document if found, null otherwise
   */
  get(key: Key): Promise<Document | null>;

  /**
   * Remove a document
   * @param key - Document key (type and id)
   * @param opts - Optional remove options (git commit, etc.)
   */
  remove(key: Key, opts?: RemoveOptions): Promise<void>;

  /**
   * List all document IDs for a given type
   * @param type - Entity type
   * @returns Array of document IDs
   */
  list(type: string): Promise<string[]>;

  /**
   * Query documents using Mango query language
   * @param query - Query specification
   * @returns Array of matching documents
   */
  query(query: QuerySpec): Promise<Document[]>;

  /**
   * Ensure an equality index exists for fast lookups
   * @param type - Entity type
   * @param field - Field name to index
   */
  ensureIndex(type: string, field: string): Promise<void>;

  /**
   * Rebuild indexes for a type
   * @param type - Entity type
   * @param fields - Optional array of fields to rebuild (default: all)
   */
  rebuildIndexes(type: string, fields?: string[]): Promise<void>;

  /**
   * Format documents to ensure canonical representation
   * @param target - What to format (all documents or specific type/document)
   * @param options - Format operation options (dry run, fail fast)
   * @returns Number of documents that were (or would be) reformatted
   */
  format(target?: FormatTarget, options?: FormatOptions): Promise<number>;

  /**
   * Get statistics for the store or a specific type
   * @param type - Optional entity type (omit for store-wide stats)
   * @returns Statistics object
   */
  stats(type?: string): Promise<StoreStats>;

  /**
   * Close the store and clean up resources
   */
  close(): Promise<void>;
}
