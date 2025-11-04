/**
 * JSON Store SDK
 *
 * A Git-backed, file-based data store with Mango query language
 */

// Re-export types
export type {
  StoreOptions,
  Key,
  Document,
  FieldOperator,
  LogicalOperator,
  Filter,
  Projection,
  Sort,
  QuerySpec,
  WriteOptions,
  RemoveOptions,
  StoreStats,
  FormatTarget,
  Store,
  SchemaRef,
  ValidationMode,
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
  SchemaRegistry,
  SchemaValidator,
  FormatValidator,
} from "./types.js";

// Re-export cache types
export type { CacheEntry, CacheOptions, CacheStats } from "./cache.js";
export { DocumentCache } from "./cache.js";

// Re-export utilities
export { stableStringify, normalizeJSON, jsonEqual } from "./format.js";
export { matches, project, sortDocuments, paginate, getPath } from "./query.js";
export {
  validateKey,
  validateDocument,
  validateName,
  sanitizePath,
  validateWithSchema,
  validateSchemaRef,
} from "./validation.js";

// Re-export schema components
export { createSchemaRegistry } from "./schema/registry.js";
export { createSchemaValidator } from "./schema/validator.js";
export {
  DEFAULT_FORMATS,
  slugFormat,
  iso3166_1_alpha_2Format,
  iso3166_2Format,
  markdownPathFormat,
} from "./schema/formats.js";

// Re-export I/O operations
export { atomicWrite, readDocument, removeDocument, ensureDirectory, listFiles } from "./io.js";

// Re-export errors
export {
  JSONStoreError,
  DocumentNotFoundError,
  DocumentReadError,
  DocumentWriteError,
  DocumentRemoveError,
  DirectoryError,
  ListFilesError,
} from "./errors.js";

// Store implementation will be added in next phase
export { openStore } from "./store.js";
