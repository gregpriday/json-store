/**
 * Schema helper utilities for CLI commands
 */

import { readFile, copyFile, mkdir } from "fs/promises";
import { join, basename } from "path";
import type { SchemaRef, SchemaRegistry } from "@jsonstore/sdk";
import { validateSchemaRef } from "@jsonstore/sdk";

/**
 * Load and validate a schema file
 * @param schemaPath - Path to schema file
 * @returns Parsed schema object
 */
export async function loadSchemaFile(schemaPath: string): Promise<object> {
  const content = await readFile(schemaPath, "utf-8");
  const schema = JSON.parse(content);

  if (typeof schema !== "object" || schema === null) {
    throw new Error("Schema must be a JSON object");
  }

  return schema;
}

/**
 * Validate schema structure for addition to registry
 * @param schema - Schema object to validate
 * @param filename - Original filename for error messages
 */
export function validateSchemaForRegistry(schema: any, filename: string): void {
  // Require $id field
  if (!schema.$id || typeof schema.$id !== "string") {
    throw new Error(`Schema must have a $id field`);
  }

  // Validate $id format
  try {
    validateSchemaRef(schema.$id);
  } catch (err) {
    throw new Error(`Invalid schema $id: ${(err as Error).message}`);
  }

  // Require $schema field
  if (!schema.$schema || typeof schema.$schema !== "string") {
    throw new Error(`Schema must have a $schema field specifying the JSON Schema draft version`);
  }

  // Enforce Draft 2020-12
  const validDrafts = [
    "https://json-schema.org/draft/2020-12/schema",
    "http://json-schema.org/draft/2020-12/schema",
  ];
  if (!validDrafts.includes(schema.$schema)) {
    throw new Error(
      `Schema must use JSON Schema Draft 2020-12. Got: ${schema.$schema}, expected: ${validDrafts[0]}`
    );
  }

  // Check filename matches $id
  const expectedFilename = schema.$id.replace("schema/", "") + ".json";
  if (filename !== expectedFilename) {
    throw new Error(
      `Schema filename "${filename}" must match $id "${schema.$id}" (expected: "${expectedFilename}")`
    );
  }
}

/**
 * Add a schema to the registry
 * @param schemaPath - Path to source schema file
 * @param rootDir - Data directory root
 * @returns Schema reference that was added
 */
export async function addSchemaToRegistry(schemaPath: string, rootDir: string): Promise<SchemaRef> {
  const schema = await loadSchemaFile(schemaPath);
  const filename = basename(schemaPath);

  // Validate schema
  validateSchemaForRegistry(schema, filename);

  const schemaRef = (schema as any).$id as SchemaRef;

  // Ensure schemas directory exists
  const schemasDir = join(rootDir, "_meta", "schemas");
  await mkdir(schemasDir, { recursive: true });

  // Copy schema to registry
  const destPath = join(schemasDir, filename);
  await copyFile(schemaPath, destPath);

  return schemaRef;
}

/**
 * Format schema list for CLI output
 * @param registry - Schema registry
 * @returns Formatted schema list
 */
export function formatSchemaList(registry: SchemaRegistry): string[] {
  const refs = registry.list();

  if (refs.length === 0) {
    return ["No schemas found"];
  }

  const lines: string[] = [];
  lines.push(`Found ${refs.length} schema(s):\n`);

  for (const ref of refs) {
    const schema = registry.get(ref);
    if (!schema) continue;

    const title = (schema as any).title || "Untitled";
    const description = (schema as any).description || "";

    lines.push(`  ${ref}`);
    lines.push(`    Title: ${title}`);
    if (description) {
      const truncated =
        description.length > 60 ? description.substring(0, 60) + "..." : description;
      lines.push(`    Description: ${truncated}`);
    }
    lines.push("");
  }

  return lines;
}
