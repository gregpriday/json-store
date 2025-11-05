/**
 * Core types for JSON Store
 */

/**
 * Schema reference format: schema/<kind>@<major>
 * @example "schema/city@1"
 */
export type SchemaRef = `schema/${string}@${number}`;

/**
 * Validation mode for schema enforcement
 */
export type ValidationMode = "strict" | "lenient" | "off";

/**
 * Validation error codes
 */
export type ValidationErrorCode =
  | "required"
  | "type"
  | "enum"
  | "format"
  | "additional"
  | "ref"
  | "custom"
  | "pattern"
  | "minimum"
  | "maximum"
  | "minLength"
  | "maxLength";

/**
 * Validation error with JSON Pointer path
 */
export interface ValidationError {
  /** Error code categorizing the type of validation failure */
  code: ValidationErrorCode;
  /** JSON Pointer path to the failing field (e.g., "/address/city") */
  pointer: string;
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: Record<string, unknown>;
}

/**
 * Result of schema validation
 */
export interface ValidationResult {
  /** True if validation passed, false otherwise */
  ok: boolean;
  /** Array of validation errors (empty if ok is true) */
  errors: ValidationError[];
}

/**
 * Schema registry interface for managing JSON Schemas
 */
export interface SchemaRegistry {
  /**
   * Load all schemas from the registry directory
   * @param rootDir - Root directory containing _meta/schemas/
   */
  loadAll(rootDir: string): Promise<void>;

  /**
   * Get raw schema JSON by reference
   * @param ref - Schema reference (e.g., "schema/city@1")
   * @returns Schema object or null if not found
   */
  get(ref: SchemaRef): object | null;

  /**
   * Get compiled validation function for a schema
   * @param ref - Schema reference (e.g., "schema/city@1")
   * @returns Compiled validation function
   */
  getCompiled(ref: SchemaRef): ((data: any) => boolean) | null;

  /**
   * Resolve a $ref within a schema
   * @param ref - Schema reference
   * @param jsonPtr - Optional JSON Pointer within the schema
   * @returns Resolved schema fragment
   */
  resolveRef(ref: SchemaRef, jsonPtr?: string): object | null;

  /**
   * Check if a schema exists
   * @param ref - Schema reference
   * @returns True if schema exists
   */
  has(ref: SchemaRef): boolean;

  /**
   * List all schema references in the registry
   * @returns Array of schema references
   */
  list(): SchemaRef[];
}

/**
 * Schema validator interface
 */
export interface SchemaValidator {
  /**
   * Validate a document against its schema
   * @param doc - Document to validate
   * @param schemaRef - Schema reference
   * @param mode - Validation mode
   * @returns Validation result
   */
  validate(doc: Document, schemaRef: SchemaRef, mode: ValidationMode): ValidationResult;

  /**
   * Register custom format validators
   * @param formats - Map of format name to validator function
   */
  registerFormats(formats: Record<string, (value: string) => boolean>): void;
}

/**
 * Custom format validator function
 */
export type FormatValidator = (value: string) => boolean;

/**
 * Options for slug generation per type
 */
export interface SlugOptions {
  /** Source field(s) to generate slug from (e.g., "name" or ["firstName", "lastName"]) */
  source: string | string[];
  /** Maximum length for the slug (default: 64) */
  maxLength?: number;
  /** Reserved words that cannot be used as slugs */
  reservedWords?: string[];
  /** Transliteration strategy: 'ascii' (default), 'none', or custom function */
  transliterate?: "ascii" | "none" | ((s: string) => string);
  /** Scope function to determine uniqueness scope (e.g., doc => doc.country) */
  scope?: (doc: any) => string;
  /** Collision strategy: 'counter' (default) or 'hash' */
  collisionStrategy?: "counter" | "hash";
  /** Whether slug is immutable after document is published (default: false) */
  immutableOnPublish?: boolean;
  /** Whether to allow renaming published slugs with alias creation (default: true) */
  allowPublishedRename?: boolean;
  /** Locale for case conversion (default: 'en') */
  locale?: string;
}

/**
 * Slug configuration per type
 */
export type SlugConfig = Record<string, SlugOptions>;

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
  /** Enable hierarchical key-value storage with secondary indexes (default: false) */
  enableHierarchy?: boolean;
  /** Schema validation mode (default: "off") */
  schemaMode?: ValidationMode;
  /** Custom format validators for JSON Schema validation */
  customFormats?: Record<string, FormatValidator>;
  /** Default schema mappings by kind: { kind: SchemaRef } */
  defaultSchemas?: Record<string, SchemaRef>;
  /** Slug configuration per type */
  slugConfig?: SlugConfig;
  /** Experimental options */
  experimental?: {
    /** Index version for backward compatibility tracking (default: 1) */
    indexVersion?: number;
    /** Maximum depth for hierarchical trees (default: 32) */
    maxDepth?: number;
    /** Maximum number of nodes to reparent in a single operation (default: 10000) */
    maxReparent?: number;
  };
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
  /** Optional kind field for grouping related types */
  kind?: string;
  /** Optional schema reference for validation */
  schemaRef?: SchemaRef;
  /** Optional slug for human-readable URLs */
  slug?: string;
  /** Optional aliases for redirects (when slug changes) */
  aliases?: string[];
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
 * Detailed statistics with per-type breakdown
 */
export interface DetailedStats extends StoreStats {
  /** Average document size in bytes */
  avgBytes: number;
  /** Minimum document size in bytes */
  minBytes: number;
  /** Maximum document size in bytes */
  maxBytes: number;
  /** Per-type statistics (optional) */
  types?: Record<string, StoreStats>;
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
 * Branded type for normalized slugs (lowercase, ASCII-hyphen, NFC normalized)
 */
export type Slug = string & { readonly __brand: "Slug" };

/**
 * Branded type for materialized paths (canonical, NFC, leading /, segments are slugs)
 */
export type MaterializedPath = string & { readonly __brand: "MaterializedPath" };

/**
 * Scope dimension for scoped slug resolution
 * Example: { dimension: "country", value: "US" }
 */
export interface ScopeDimension {
  dimension: string;
  value: string;
}

/**
 * Hierarchical key with parent reference and slug
 */
export interface HierarchicalKey extends Key {
  /** Optional parent key for hierarchical relationships */
  parentKey?: Key;
  /** Optional slug for scoped resolution (must be unique within scope) */
  slug?: Slug;
  /** Materialized path for efficient ancestor queries */
  path?: MaterializedPath;
  /** Scope dimensions for slug uniqueness (e.g., country, region) */
  scope?: ScopeDimension[];
}

/**
 * Path specification for slug-based resolution
 */
export interface PathSpec {
  /** Scope value (e.g., "US" for country scope) */
  scope: string;
  /** Entity type */
  type: string;
  /** Slug path (e.g., "new-york/new-york" for city in NY region) */
  slugPath: string;
}

/**
 * Children index metadata
 */
export interface ChildrenIndex {
  /** Array of child IDs */
  ids: string[];
  /** Total number of children */
  total: number;
  /** Last update timestamp */
  updated: string;
}

/**
 * Pagination cursor for child enumeration (opaque to users)
 */
export interface PaginationCursor {
  /** Bucket index */
  bucket: number;
  /** Last sort key in previous page */
  lastSortKey: string;
}

/**
 * Options for listing children
 */
export interface ListChildrenOptions {
  /** Page size (default: 100, max: 1000) */
  pageSize?: number;
  /** Opaque cursor from previous page */
  cursor?: string;
}

/**
 * Paginated result page
 */
export interface Page<T> {
  /** Items in this page */
  items: T[];
  /** Total count (if known) */
  total?: number;
  /** Opaque cursor for next page (undefined if no more pages) */
  nextCursor?: string;
}

/**
 * Report from hierarchy repair operation
 */
export interface RepairReport {
  /** Types that were repaired */
  types: string[];
  /** Total documents scanned */
  documentsScanned: number;
  /** Indexes rebuilt */
  indexesRebuilt: number;
  /** Errors encountered (non-fatal) */
  errors: Array<{ path: string; error: string }>;
  /** Duration in milliseconds */
  durationMs: number;
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
   * @param options - Rebuild options (fields, force)
   */
  rebuildIndexes(type: string, options?: RebuildIndexesOptions): Promise<ReindexSummary>;

  /**
   * Reindex all types in the store
   * @param options - Reindex options (force)
   */
  reindex(options?: ReindexOptions): Promise<ReindexAllSummary>;

  /**
   * Get a document by slug
   * @param type - Entity type
   * @param scopeKey - Scope key (e.g., country code for scoped slugs)
   * @param slug - Slug to look up
   * @returns Document if found, null otherwise
   */
  getBySlug(type: string, scopeKey: string, slug: string): Promise<Document | null>;

  /**
   * Resolve a slug or alias to a document
   * @param type - Entity type
   * @param scopeKey - Scope key
   * @param slugOrAlias - Slug or alias to resolve
   * @returns Document if found, null otherwise
   */
  resolveSlugOrAlias(type: string, scopeKey: string, slugOrAlias: string): Promise<Document | null>;

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
   * Get detailed statistics with per-type breakdown
   * @returns Detailed statistics object
   */
  detailedStats(): Promise<DetailedStats>;

  /**
   * Close the store and clean up resources
   */
  close(): Promise<void>;

  // Hierarchical operations (requires enableHierarchy: true)

  /**
   * Store or update a document with hierarchical relationships
   * @param key - Document key (type and id)
   * @param doc - Document to store
   * @param parentKey - Optional parent key for hierarchy
   * @param slug - Optional slug for scoped resolution (must be unique within scope)
   * @param opts - Optional write options
   */
  putHierarchical(
    key: HierarchicalKey,
    doc: Document,
    parentKey?: Key,
    slug?: Slug,
    opts?: WriteOptions
  ): Promise<void>;

  /**
   * Resolve entity by scoped slug path
   * @param scope - Scope value (e.g., "US")
   * @param type - Entity type
   * @param slugPath - Slug path (e.g., "new-york/new-york")
   * @returns Document if found, null otherwise
   */
  getByPath(scope: string, type: string, slugPath: string): Promise<Document | null>;

  /**
   * List children of a parent with pagination
   * @param parentKey - Parent key
   * @param options - Pagination options
   * @returns Paginated results
   */
  listChildren(parentKey: Key, options?: ListChildrenOptions): Promise<Page<Document>>;

  /**
   * Find document by materialized path
   * @param path - Materialized path (e.g., "/US/NY")
   * @returns Document if found, null otherwise
   */
  findByPath(path: MaterializedPath): Promise<Document | null>;

  /**
   * Rebuild hierarchical indexes from primary documents
   * @param type - Optional type to rebuild (omit for all types)
   * @returns Repair report
   */
  repairHierarchy(type?: string): Promise<RepairReport>;
}

/**
 * Statistics for rebuilding a single field index
 */
export interface ReindexFieldStats {
  /** Field name */
  field: string;
  /** Number of documents scanned */
  docsScanned: number;
  /** Number of index keys created */
  keys: number;
  /** Index file size in bytes */
  bytes: number;
  /** Rebuild duration in milliseconds */
  durationMs: number;
}

/**
 * Summary statistics for rebuilding indexes on a type
 */
export interface ReindexSummary {
  /** Entity type */
  type: string;
  /** Number of documents scanned */
  docsScanned: number;
  /** Per-field statistics */
  fields: ReindexFieldStats[];
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Summary statistics for reindexing all types
 */
export interface ReindexAllSummary {
  /** Total documents scanned across all types */
  totalDocs: number;
  /** Total indexes rebuilt */
  totalIndexes: number;
  /** Per-type summaries */
  types: ReindexSummary[];
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Options for rebuilding indexes
 */
export interface RebuildIndexesOptions {
  /** Specific fields to rebuild (omit for all) */
  fields?: string[];
  /** Force rebuild by deleting existing indexes first */
  force?: boolean;
}

/**
 * Options for reindexing all types
 */
export type ReindexOptions = Pick<RebuildIndexesOptions, "force">;
