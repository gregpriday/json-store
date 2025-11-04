/**
 * Validation utilities for store operations
 */

import type {
  Key,
  Document,
  Slug,
  MaterializedPath,
  SchemaRef,
  SchemaValidator,
  ValidationMode,
  ValidationResult,
} from "./types.js";

/**
 * Valid characters for type and ID: alphanumeric, underscore, dash, dot
 */
const VALID_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Windows reserved device names (case-insensitive)
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * Valid slug pattern: alphanumeric with dashes (supports Unicode)
 * Allows letters, digits, and dashes (some scripts don't have uppercase/lowercase)
 */
const VALID_SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

/**
 * Validate a type or ID string
 * @param value - Value to validate
 * @param label - Label for error messages ("type" or "id")
 * @throws Error if invalid
 */
export function validateName(value: string, label: "type" | "id"): void {
  if (!value || typeof value !== "string") {
    throw new Error(`${label} must be a non-empty string`);
  }

  if (!VALID_NAME_PATTERN.test(value)) {
    throw new Error(
      `${label} contains invalid characters: "${value}". ` +
        `Only alphanumeric, underscore, dash, and dot are allowed.`
    );
  }

  if (value.startsWith(".") || value.startsWith("-")) {
    throw new Error(`${label} cannot start with "." or "-": "${value}"`);
  }

  if (value.includes("..") || value.includes("//")) {
    throw new Error(`${label} cannot contain ".." or "//": "${value}"`);
  }

  // Windows: reject trailing dots and spaces
  if (value.endsWith(".") || value.endsWith(" ")) {
    throw new Error(`${label} cannot end with "." or space: "${value}"`);
  }

  // Windows: reject reserved device names (case-insensitive)
  const baseName = value.split(".")[0]!.toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    throw new Error(
      `${label} cannot be a Windows reserved name: "${value}". ` +
        `Reserved names: CON, PRN, AUX, NUL, COM1-9, LPT1-9`
    );
  }
}

/**
 * Validate a document key
 * @param key - Key to validate
 * @throws Error if invalid
 */
export function validateKey(key: Key): void {
  validateName(key.type, "type");
  validateName(key.id, "id");
}

/**
 * Validate that a document matches its key
 * @param key - Expected key
 * @param doc - Document to validate
 * @throws Error if document doesn't match key
 */
export function validateDocument(key: Key, doc: Document): void {
  if (!doc || typeof doc !== "object") {
    throw new Error("Document must be an object");
  }

  if (doc.type !== key.type) {
    throw new Error(`Document type "${doc.type}" does not match key type "${key.type}"`);
  }

  if (doc.id !== key.id) {
    throw new Error(`Document id "${doc.id}" does not match key id "${key.id}"`);
  }
}

/**
 * Sanitize a path component to prevent directory traversal
 * @param component - Path component to sanitize
 * @returns Sanitized component
 * @throws Error if component is unsafe
 */
export function sanitizePath(component: string): string {
  if (component.includes("/") || component.includes("\\")) {
    throw new Error(`Path component cannot contain slashes: "${component}"`);
  }
  if (component === "." || component === "..") {
    throw new Error(`Path component cannot be "." or ".."`);
  }
  return component;
}

/**
 * Validate a type name to prevent path traversal attacks
 * @param typeName - Type name to validate
 * @throws Error if type name is unsafe
 */
export function validateTypeName(typeName: string): void {
  if (!typeName || typeof typeName !== "string") {
    throw new Error("Type name must be a non-empty string");
  }

  // Check for path separators
  if (typeName.includes("/") || typeName.includes("\\")) {
    throw new Error(`Type name cannot contain path separators: "${typeName}"`);
  }

  // Check for path traversal sequences
  if (typeName.includes("..")) {
    throw new Error(`Type name cannot contain "..": "${typeName}"`);
  }

  // Check for absolute paths (Unix or Windows)
  if (typeName.includes(":")) {
    throw new Error(`Type name cannot contain ":": "${typeName}"`);
  }

  // Reject names starting with underscore or dot (reserved for internal use)
  if (typeName.startsWith("_") || typeName.startsWith(".")) {
    throw new Error(`Type name cannot start with "_" or ".": "${typeName}"`);
  }
}

/**
 * Slug validation pattern: lowercase letters, digits, hyphens only
 * Must start with letter or digit, cannot have consecutive hyphens
 */
const VALID_SLUG_PATTERN_STRICT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Zero-width and control characters that should be rejected
 */
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\u2060\uFEFF\u00AD]/;

/**
 * URL-encoded slash patterns
 */
const ENCODED_SLASH_PATTERN = /%2[fF]/;

/**
 * Validate and normalize a slug
 * Slugs must be lowercase, ASCII alphanumeric with hyphens, NFC normalized
 * @param slug - Slug to validate
 * @returns Validated slug
 * @throws Error if slug is invalid
 */
export function validateSlug(slug: string): Slug {
  if (!slug || typeof slug !== "string") {
    throw new Error("Slug must be a non-empty string");
  }

  // Normalize to NFC form
  const normalized = slug.normalize("NFC");

  // Check for zero-width characters
  if (ZERO_WIDTH_CHARS.test(normalized)) {
    throw new Error(`Slug contains zero-width or control characters: "${slug}"`);
  }

  // Check for path traversal attempts
  if (normalized.includes("..") || normalized === ".") {
    throw new Error(`Slug cannot contain path traversal sequences: "${slug}"`);
  }

  // Check for URL-encoded slashes
  if (ENCODED_SLASH_PATTERN.test(normalized)) {
    throw new Error(`Slug cannot contain URL-encoded slashes: "${slug}"`);
  }

  // Check for slashes
  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(`Slug cannot contain slashes: "${slug}"`);
  }

  // Must be lowercase
  if (normalized !== normalized.toLowerCase()) {
    throw new Error(`Slug must be lowercase: "${slug}"`);
  }

  // Check pattern: alphanumeric + hyphens, no consecutive hyphens
  if (!VALID_SLUG_PATTERN_STRICT.test(normalized)) {
    throw new Error(
      `Slug contains invalid characters or format: "${slug}". ` +
        `Only lowercase letters, digits, and single hyphens allowed. ` +
        `Must start and end with letter or digit.`
    );
  }

  // Check for reserved prefixes
  if (normalized.startsWith("_") || normalized.startsWith(".")) {
    throw new Error(`Slug cannot start with "_" or ".": "${slug}"`);
  }

  // Max length check (reasonable limit for filesystem)
  if (normalized.length > 255) {
    throw new Error(`Slug too long (max 255 characters): "${slug}"`);
  }

  return normalized as Slug;
}

/**
 * Validate a materialized path
 * Paths must start with /, contain only slugs as segments, NFC normalized
 * @param path - Path to validate
 * @returns Validated path
 * @throws Error if path is invalid
 */
export function validateMaterializedPath(path: string): MaterializedPath {
  if (!path || typeof path !== "string") {
    throw new Error("Path must be a non-empty string");
  }

  // Normalize to NFC form
  const normalized = path.normalize("NFC");

  // Must start with /
  if (!normalized.startsWith("/")) {
    throw new Error(`Path must start with "/": "${path}"`);
  }

  // Cannot end with / unless it's just "/"
  if (normalized.length > 1 && normalized.endsWith("/")) {
    throw new Error(`Path cannot end with "/": "${path}"`);
  }

  // Check for zero-width characters
  if (ZERO_WIDTH_CHARS.test(normalized)) {
    throw new Error(`Path contains zero-width or control characters: "${path}"`);
  }

  // Check for double slashes
  if (normalized.includes("//")) {
    throw new Error(`Path cannot contain double slashes: "${path}"`);
  }

  // Check for path traversal
  if (normalized.includes("/..") || normalized.includes("./")) {
    throw new Error(`Path cannot contain traversal sequences: "${path}"`);
  }

  // Check for URL-encoded slashes
  if (ENCODED_SLASH_PATTERN.test(normalized)) {
    throw new Error(`Path cannot contain URL-encoded slashes: "${path}"`);
  }

  // Split and validate each segment
  const segments = normalized.split("/").slice(1); // Skip empty first element
  if (segments.length === 0 && normalized !== "/") {
    throw new Error(`Path must contain at least one segment: "${path}"`);
  }

  for (const segment of segments) {
    if (!segment) {
      throw new Error(`Path contains empty segment: "${path}"`);
    }
    // Each segment should be a valid slug
    validateSlug(segment);
  }

  // Max length check (combined path length)
  if (normalized.length > 1024) {
    throw new Error(`Path too long (max 1024 characters): "${path}"`);
  }

  return normalized as MaterializedPath;
}

/**
 * Validate path depth doesn't exceed maximum
 * @param path - Path to check
 * @param maxDepth - Maximum allowed depth (default: 32)
 * @throws Error if depth exceeds maximum
 */
export function validatePathDepth(path: MaterializedPath, maxDepth: number = 32): void {
  const depth = path === "/" ? 0 : path.split("/").length - 1;
  if (depth > maxDepth) {
    throw new Error(`Path depth ${depth} exceeds maximum ${maxDepth}: "${path}"`);
  }
}

/**
 * Validate a slug string (simple check without returning branded type)
 * @param slug - Slug to validate
 * @param label - Label for error messages (e.g., "slug" or "alias")
 * @throws Error if slug is invalid
 */
export function validateSlugString(slug: string, label: string = "slug"): void {
  if (!slug || typeof slug !== "string") {
    throw new Error(`${label} must be a non-empty string`);
  }

  // Check format: lowercase alphanumeric with dashes
  if (!VALID_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `${label} contains invalid characters: "${slug}". ` +
        `Slugs must be lowercase alphanumeric with dashes, matching: /^[a-z0-9]+(?:-[a-z0-9]+)*$/`
    );
  }

  // Check length (reasonable maximum)
  if (slug.length > 256) {
    throw new Error(`${label} is too long: "${slug}". Maximum length is 256 characters.`);
  }

  // Prevent only dashes or numbers
  if (/^[0-9-]+$/.test(slug)) {
    throw new Error(`${label} cannot consist only of numbers and dashes: "${slug}"`);
  }
}

/**
 * Validate a document against its schema
 * @param doc - Document to validate
 * @param schemaRef - Schema reference
 * @param validator - Schema validator instance
 * @param mode - Validation mode
 * @returns Validation result
 */
export function validateWithSchema(
  doc: Document,
  schemaRef: SchemaRef,
  validator: SchemaValidator,
  mode: ValidationMode
): ValidationResult {
  return validator.validate(doc, schemaRef, mode);
}

/**
 * Validate a SchemaRef format
 * @param ref - Schema reference to validate
 * @throws Error if format is invalid
 */
export function validateSchemaRef(ref: string): asserts ref is SchemaRef {
  const pattern = /^schema\/[a-zA-Z0-9_-]+@\d+$/;
  if (!pattern.test(ref)) {
    throw new Error(
      `Invalid SchemaRef format: "${ref}". ` +
        `Must match pattern: schema/<kind>@<major> (e.g., "schema/city@1")`
    );
  }
}

/**
 * Validate slug field on a document (if present)
 * @param doc - Document to validate
 * @throws Error if slug is present but invalid
 */
export function validateDocumentSlug(doc: Document): void {
  if (doc.slug !== undefined) {
    if (typeof doc.slug !== "string") {
      throw new Error(`Document slug must be a string, got: ${typeof doc.slug}`);
    }
    validateSlugString(doc.slug, "Document slug");
  }

  // Validate aliases if present
  if (doc.aliases !== undefined) {
    if (!Array.isArray(doc.aliases)) {
      throw new Error(`Document aliases must be an array, got: ${typeof doc.aliases}`);
    }

    for (const alias of doc.aliases) {
      if (typeof alias !== "string") {
        throw new Error(`Alias must be a string, got: ${typeof alias}`);
      }
      validateSlugString(alias, "Alias");
    }
  }
}
