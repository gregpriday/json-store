/**
 * Error types for JSON Store operations
 *
 * Invariants:
 * - All errors include the absolute target path in the message
 * - All errors support a `cause` property for wrapping underlying errors
 * - All errors have stable `name` and `code` fields for programmatic handling
 */

/**
 * Base class for all JSON Store errors
 */
export abstract class JSONStoreError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a document cannot be found
 */
export class DocumentNotFoundError extends JSONStoreError {
  readonly code = "ENOENT";

  constructor(filePath: string, options?: ErrorOptions) {
    super(`Document not found: ${filePath}`, options);
  }
}

/**
 * Thrown when a document read operation fails
 */
export class DocumentReadError extends JSONStoreError {
  readonly code = "READ_ERROR";

  constructor(filePath: string, options?: ErrorOptions) {
    super(`Failed to read document: ${filePath}`, options);
  }
}

/**
 * Thrown when a document write operation fails
 */
export class DocumentWriteError extends JSONStoreError {
  readonly code = "WRITE_ERROR";

  constructor(filePath: string, options?: ErrorOptions) {
    super(`Failed to write document: ${filePath}`, options);
  }
}

/**
 * Thrown when a document removal operation fails
 */
export class DocumentRemoveError extends JSONStoreError {
  readonly code = "REMOVE_ERROR";

  constructor(filePath: string, options?: ErrorOptions) {
    super(`Failed to remove document: ${filePath}`, options);
  }
}

/**
 * Thrown when a directory operation fails
 */
export class DirectoryError extends JSONStoreError {
  readonly code = "DIRECTORY_ERROR";

  constructor(dirPath: string, options?: ErrorOptions) {
    super(`Directory operation failed: ${dirPath}`, options);
  }
}

/**
 * Thrown when listing files in a directory fails
 */
export class ListFilesError extends JSONStoreError {
  readonly code = "LIST_ERROR";

  constructor(dirPath: string, options?: ErrorOptions) {
    super(`Failed to list files in directory: ${dirPath}`, options);
  }
}

/**
 * Thrown when a document formatting operation fails
 */
export class FormatError extends JSONStoreError {
  readonly code = "FORMAT_ERROR";

  constructor(filePath: string, options?: ErrorOptions) {
    super(`Failed to format document: ${filePath}`, options);
  }
}

/**
 * Thrown when a markdown file path is invalid
 */
export class MarkdownPathError extends JSONStoreError {
  readonly code = "E_MD_PATH";

  constructor(path: string, reason: string, options?: ErrorOptions) {
    super(`Invalid markdown path "${path}": ${reason}`, options);
  }
}

/**
 * Thrown when a referenced markdown file does not exist
 */
export class MarkdownMissingError extends JSONStoreError {
  readonly code = "E_MD_MISSING";

  constructor(
    public readonly key: string,
    public readonly resolvedPath: string,
    options?: ErrorOptions
  ) {
    super(`Markdown file not found for field "${key}": ${resolvedPath}`, options);
  }
}

/**
 * Thrown when markdown file integrity check fails
 */
export class MarkdownIntegrityError extends JSONStoreError {
  readonly code = "E_MD_SHA";

  constructor(
    public readonly path: string,
    public readonly expected: string,
    public readonly actual: string,
    options?: ErrorOptions
  ) {
    super(
      `Markdown integrity check failed for ${path}: expected ${expected.slice(0, 8)}..., got ${actual.slice(0, 8)}...`,
      options
    );
  }
}
