/**
 * Schema registry for loading, caching, and resolving JSON Schemas
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { SchemaRef, SchemaRegistry } from "../types.js";
import Ajv2020 from "ajv/dist/2020.js";
import type { default as Ajv } from "ajv";

/**
 * Schema metadata with compilation cache
 */
interface SchemaEntry {
  /** Raw schema JSON */
  schema: object;
  /** Content digest for cache invalidation */
  digest: string;
  /** Compiled validation function */
  compiled?: (data: any) => boolean;
}

/**
 * Implementation of SchemaRegistry
 * Loads schemas from data/_meta/schemas/, validates them, and maintains a compile cache
 */
export class SchemaRegistryImpl implements SchemaRegistry {
  #schemas: Map<SchemaRef, SchemaEntry> = new Map();
  #ajv: Ajv;
  #schemasDir: string | null = null;

  constructor() {
    // Initialize Ajv with strict settings for Draft 2020-12
    this.#ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      verbose: true,
      // Support Draft 2020-12
      discriminator: true,
    });
  }

  /**
   * Load all schemas from the registry directory
   */
  async loadAll(rootDir: string): Promise<void> {
    this.#schemasDir = join(rootDir, "_meta", "schemas");

    try {
      const files = await readdir(this.#schemasDir);
      const schemaFiles = files.filter((f) => f.endsWith(".json"));

      for (const file of schemaFiles) {
        await this.#loadSchemaFile(file);
      }
    } catch (err) {
      // If schemas directory doesn't exist, that's okay - no schemas loaded
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }
  }

  /**
   * Load and validate a single schema file
   */
  async #loadSchemaFile(filename: string): Promise<void> {
    if (!this.#schemasDir) {
      throw new Error("Schema registry not initialized. Call loadAll() first.");
    }

    const filePath = join(this.#schemasDir, filename);
    const content = await readFile(filePath, "utf-8");
    const schema = JSON.parse(content);

    // Validate schema structure
    this.#validateSchemaStructure(schema, filename);

    // Extract SchemaRef from $id
    const schemaRef = schema.$id as SchemaRef;

    // Compute content digest for cache invalidation
    const digest = this.#computeDigest(content);

    // Check if schema already exists with same digest (skip reload)
    const existing = this.#schemas.get(schemaRef);
    if (existing?.digest === digest) {
      return;
    }

    // If schema exists with different digest, remove old version first
    if (existing) {
      this.#ajv.removeSchema(schemaRef);
    }

    // Store schema entry
    this.#schemas.set(schemaRef, {
      schema,
      digest,
    });

    // Add schema to Ajv for $ref resolution
    this.#ajv.addSchema(schema, schemaRef);
  }

  /**
   * Validate schema structure and requirements
   */
  #validateSchemaStructure(schema: any, filename: string): void {
    if (typeof schema !== "object" || schema === null) {
      throw new Error(`Schema file ${filename} must contain a JSON object`);
    }

    // Require $id field
    if (!schema.$id || typeof schema.$id !== "string") {
      throw new Error(`Schema file ${filename} must have a $id field`);
    }

    // Validate $id format: schema/<kind>@<major>
    const schemaRefPattern = /^schema\/[a-zA-Z0-9_-]+@\d+$/;
    if (!schemaRefPattern.test(schema.$id)) {
      throw new Error(
        `Schema $id must match format "schema/<kind>@<major>": got "${schema.$id}" in ${filename}`
      );
    }

    // Validate filename matches $id
    const expectedFilename = schema.$id.replace("schema/", "") + ".json";
    if (filename !== expectedFilename) {
      throw new Error(
        `Schema filename "${filename}" must match $id "${schema.$id}" (expected: "${expectedFilename}")`
      );
    }

    // Require $schema field for draft version
    if (!schema.$schema || typeof schema.$schema !== "string") {
      throw new Error(`Schema file ${filename} must have a $schema field specifying the draft version`);
    }

    // Enforce Draft 2020-12
    const validDrafts = [
      "https://json-schema.org/draft/2020-12/schema",
      "http://json-schema.org/draft/2020-12/schema",
    ];
    if (!validDrafts.includes(schema.$schema)) {
      throw new Error(
        `Schema ${schema.$id} must use JSON Schema Draft 2020-12. ` +
          `Got: ${schema.$schema}, expected: ${validDrafts[0]}`
      );
    }
  }

  /**
   * Compute SHA-256 digest of schema content
   */
  #computeDigest(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Get raw schema JSON by reference
   */
  get(ref: SchemaRef): object | null {
    const entry = this.#schemas.get(ref);
    return entry?.schema ?? null;
  }

  /**
   * Get compiled validation function for a schema
   */
  getCompiled(ref: SchemaRef): ((data: any) => boolean) | null {
    const entry = this.#schemas.get(ref);
    if (!entry) {
      return null;
    }

    // Return cached compiled function if available
    if (entry.compiled) {
      return entry.compiled;
    }

    // Compile and cache
    try {
      const validate = this.#ajv.getSchema(ref);
      if (!validate) {
        // Try compiling directly if not found
        const compiled = this.#ajv.compile(entry.schema);
        entry.compiled = compiled;
        return compiled;
      }
      entry.compiled = validate;
      return validate;
    } catch (err) {
      throw new Error(`Failed to compile schema ${ref}: ${(err as Error).message}`);
    }
  }

  /**
   * Resolve a $ref within a schema
   */
  resolveRef(ref: SchemaRef, jsonPtr?: string): object | null {
    const schema = this.get(ref);
    if (!schema) {
      return null;
    }

    if (!jsonPtr) {
      return schema;
    }

    // Strip leading "#" from JSON Pointer if present
    let pointer = jsonPtr;
    if (pointer.startsWith("#")) {
      pointer = pointer.slice(1);
    }

    // Empty pointer after stripping "#" means root
    if (pointer === "") {
      return schema;
    }

    // Navigate JSON Pointer
    const parts = pointer.split("/").filter((p) => p.length > 0);
    let current: any = schema;

    for (const part of parts) {
      const decoded = part.replace(/~1/g, "/").replace(/~0/g, "~");
      if (current && typeof current === "object" && decoded in current) {
        current = current[decoded];
      } else {
        return null;
      }
    }

    return current as object;
  }

  /**
   * Check if a schema exists
   */
  has(ref: SchemaRef): boolean {
    return this.#schemas.has(ref);
  }

  /**
   * List all schema references in the registry
   */
  list(): SchemaRef[] {
    return Array.from(this.#schemas.keys());
  }

  /**
   * Get Ajv instance (for advanced use cases)
   */
  getAjv(): Ajv {
    return this.#ajv;
  }
}

/**
 * Create a new schema registry instance
 */
export function createSchemaRegistry(): SchemaRegistry {
  return new SchemaRegistryImpl();
}
