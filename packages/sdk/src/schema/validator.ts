/**
 * Schema validator with mode support and error normalization
 */

import type {
  SchemaRef,
  ValidationMode,
  ValidationResult,
  ValidationError,
  ValidationErrorCode,
  Document,
  SchemaValidator,
  SchemaRegistry,
  FormatValidator,
} from "../types.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { DEFAULT_FORMATS } from "./formats.js";
import { SchemaRegistryImpl } from "./registry.js";

/**
 * Implementation of SchemaValidator
 * Validates documents against JSON Schemas with strict/lenient mode support
 */
export class SchemaValidatorImpl implements SchemaValidator {
  #registry: SchemaRegistry;
  #customFormats: Map<string, FormatValidator> = new Map();

  constructor(registry: SchemaRegistry) {
    this.#registry = registry;

    // Register standard formats from ajv-formats
    const ajv = (registry as SchemaRegistryImpl).getAjv();
    addFormats(ajv);

    // Register default custom formats
    this.registerFormats(DEFAULT_FORMATS);
  }

  /**
   * Register custom format validators
   */
  registerFormats(formats: Record<string, FormatValidator>): void {
    const ajv = (this.#registry as SchemaRegistryImpl).getAjv();

    for (const [name, validator] of Object.entries(formats)) {
      this.#customFormats.set(name, validator);
      ajv.addFormat(name, validator);
    }
  }

  /**
   * Validate a document against its schema
   */
  validate(doc: Document, schemaRef: SchemaRef, mode: ValidationMode): ValidationResult {
    // Bypass validation if mode is "off"
    if (mode === "off") {
      return { ok: true, errors: [] };
    }

    // Check if schema exists
    if (!this.#registry.has(schemaRef)) {
      return {
        ok: false,
        errors: [
          {
            code: "ref",
            pointer: "",
            message: `Schema not found: ${schemaRef}`,
            context: { schemaRef },
          },
        ],
      };
    }

    // Get compiled validator
    const validator = this.#registry.getCompiled(schemaRef) as ValidateFunction | null;
    if (!validator) {
      return {
        ok: false,
        errors: [
          {
            code: "ref",
            pointer: "",
            message: `Failed to compile schema: ${schemaRef}`,
            context: { schemaRef },
          },
        ],
      };
    }

    // Apply mode-specific schema modifications for strict mode
    let dataToValidate = doc;
    const schema = this.#registry.get(schemaRef);

    if (mode === "strict" && schema) {
      // In strict mode, we want to enforce additionalProperties: false
      // This is handled by modifying the schema at load time or using ajv options
      // For now, we'll validate as-is and handle additional properties in error processing
    }

    // Run validation
    const isValid = validator(dataToValidate);

    if (isValid) {
      return { ok: true, errors: [] };
    }

    // Process errors - ValidateFunction has an errors property
    const ajvErrors = (validator as ValidateFunction).errors ?? [];
    const errors = this.#normalizeErrors(ajvErrors, mode);

    return { ok: false, errors };
  }

  /**
   * Normalize Ajv errors to ValidationError format
   */
  #normalizeErrors(ajvErrors: ErrorObject[], mode: ValidationMode): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const err of ajvErrors) {
      const code = this.#mapErrorCode(err.keyword);
      const pointer = this.#buildPointer(err);
      const message = this.#formatErrorMessage(err);
      const context: Record<string, unknown> = {
        keyword: err.keyword,
        params: err.params,
      };

      // In lenient mode, filter out additionalProperties errors
      if (mode === "lenient" && err.keyword === "additionalProperties") {
        continue;
      }

      errors.push({ code, pointer, message, context });
    }

    return errors;
  }

  /**
   * Build correct JSON Pointer from Ajv error
   */
  #buildPointer(err: ErrorObject): string {
    const base = err.instancePath ?? "";

    // For required errors, append the missing property name
    if (err.keyword === "required" && typeof (err.params as any).missingProperty === "string") {
      const missing = (err.params as any).missingProperty;
      return base ? `${base}/${missing}` : `/${missing}`;
    }

    // Return base path (empty string for root, not "/")
    return base || "";
  }

  /**
   * Map Ajv error keyword to ValidationErrorCode
   */
  #mapErrorCode(keyword: string): ValidationErrorCode {
    switch (keyword) {
      case "required":
        return "required";
      case "type":
        return "type";
      case "enum":
        return "enum";
      case "format":
        return "format";
      case "additionalProperties":
        return "additional";
      case "$ref":
        return "ref";
      case "pattern":
        return "pattern";
      case "minimum":
      case "exclusiveMinimum":
        return "minimum";
      case "maximum":
      case "exclusiveMaximum":
        return "maximum";
      case "minLength":
        return "minLength";
      case "maxLength":
        return "maxLength";
      default:
        return "custom";
    }
  }

  /**
   * Format error message with context
   */
  #formatErrorMessage(err: ErrorObject): string {
    const path = err.instancePath || "document";

    switch (err.keyword) {
      case "required":
        return `${path} is missing required property: ${err.params.missingProperty}`;
      case "type":
        return `${path} must be ${err.params.type}`;
      case "enum":
        return `${path} must be one of: ${err.params.allowedValues.join(", ")}`;
      case "format":
        return `${path} must match format "${err.params.format}"`;
      case "additionalProperties":
        return `${path} has additional property not allowed in strict mode: ${err.params.additionalProperty}`;
      case "pattern":
        return `${path} must match pattern ${err.params.pattern}`;
      case "minimum":
        return `${path} must be >= ${err.params.limit}`;
      case "exclusiveMinimum":
        return `${path} must be > ${err.params.limit}`;
      case "maximum":
        return `${path} must be <= ${err.params.limit}`;
      case "exclusiveMaximum":
        return `${path} must be < ${err.params.limit}`;
      case "minLength":
        return `${path} must be at least ${err.params.limit} characters`;
      case "maxLength":
        return `${path} must be at most ${err.params.limit} characters`;
      default:
        return err.message || `Validation failed at ${path}`;
    }
  }
}

/**
 * Create a new schema validator instance
 */
export function createSchemaValidator(registry: SchemaRegistry): SchemaValidator {
  return new SchemaValidatorImpl(registry);
}
