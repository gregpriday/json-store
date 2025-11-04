/**
 * Validation utilities for store operations
 */

import type { Key, Document } from "./types.js";

/**
 * Valid characters for type and ID: alphanumeric, underscore, dash, dot
 */
const VALID_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

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
