/**
 * Schema management commands for CLI
 */

import { Command } from "commander";
import { createSchemaRegistry, createSchemaValidator, openStore } from "@jsonstore/sdk";
import type { Document } from "@jsonstore/sdk";
import { resolveRoot } from "../lib/env.js";
import { printLines, colorize } from "../lib/render.js";
import { CliError } from "../lib/errors.js";
import { addSchemaToRegistry, formatSchemaList } from "../lib/schema-helpers.js";
import { withTiming } from "../lib/telemetry.js";

/**
 * Create schema command group
 */
export function createSchemaCommand(program: Command): Command {
  const schema = new Command("schema").description("Manage JSON Schema validation").addHelpText(
    "after",
    `
Examples:
  $ jsonstore schema add ./schemas/city@1.json
  $ jsonstore schema list
  $ jsonstore schema validate city
  $ jsonstore schema validate city city-123
  $ jsonstore schema validate --all`
  );

  // schema add command
  schema
    .command("add <path>")
    .description("Add a schema to the registry")
    .action(async (schemaPath: string) => {
      await withTiming("cli.schema.add", async () => {
        const opts = program.opts();
        const root = resolveRoot(opts.root);

        try {
          const schemaRef = await addSchemaToRegistry(schemaPath, root);

          if (!opts.quiet) {
            console.log(colorize(`✓ Schema added: ${schemaRef}`, "green", process.stdout));
          }
        } catch (err) {
          throw new CliError(`Failed to add schema: ${(err as Error).message}`, { exitCode: 1 });
        }
      });
    });

  // schema list command
  schema
    .command("list")
    .description("List all schemas in the registry")
    .action(async () => {
      await withTiming("cli.schema.list", async () => {
        const opts = program.opts();
        const root = resolveRoot(opts.root);

        try {
          const registry = createSchemaRegistry();
          await registry.loadAll(root);

          const lines = formatSchemaList(registry);
          printLines(lines);
        } catch (err) {
          throw new CliError(`Failed to list schemas: ${(err as Error).message}`, { exitCode: 1 });
        }
      });
    });

  // schema validate command
  schema
    .command("validate [type] [id]")
    .description("Validate documents against their schemas")
    .option("--all", "Validate all documents in the store")
    .action(async (type?: string, id?: string, cmdOpts?: { all?: boolean }) => {
      await withTiming("cli.schema.validate", async () => {
        const opts = program.opts();
        const root = resolveRoot(opts.root);

        let storeInstance: ReturnType<typeof openStore> | undefined;

        try {
          // Open store inside try block
          const store = openStore({ root });
          storeInstance = store;

          // Load registry and validator
          const registry = createSchemaRegistry();
          await registry.loadAll(root);

          const validator = createSchemaValidator(registry);

          let documentsToValidate: Document[] = [];
          let totalCount = 0;
          let errorCount = 0;
          let warningCount = 0;

          if (cmdOpts?.all) {
            // Validate all documents
            if (!opts.quiet) {
              console.log("Validating all documents...\n");
            }

            // Get all types
            const types: string[] = [];

            try {
              const entries = await readdir(root);
              for (const entry of entries) {
                const stat = await lstat(join(root, entry));
                // Skip hidden directories, meta directories, and symlinks
                if (
                  stat.isDirectory() &&
                  !stat.isSymbolicLink() &&
                  !entry.startsWith("_") &&
                  !entry.startsWith(".")
                ) {
                  types.push(entry);
                }
              }
            } catch (err) {
              throw new CliError(
                `Unable to read document types from ${root}: ${(err as Error).message}`,
                {
                  exitCode: 1,
                }
              );
            }

            // Collect all documents
            for (const docType of types) {
              const ids = await store.list(docType);
              for (const docId of ids) {
                const doc = await store.get({ type: docType, id: docId });
                if (doc) {
                  documentsToValidate.push(doc);
                }
              }
            }
          } else if (type && id) {
            // Validate specific document
            const doc = await store.get({ type, id });
            if (!doc) {
              throw new CliError(`Document not found: ${type}/${id}`, { exitCode: 1 });
            }
            documentsToValidate = [doc];
          } else if (type) {
            // Validate all documents of a type
            const ids = await store.list(type);
            for (const docId of ids) {
              const doc = await store.get({ type, id: docId });
              if (doc) {
                documentsToValidate.push(doc);
              }
            }
          } else {
            throw new CliError("Must specify --all, <type>, or <type> <id>", { exitCode: 1 });
          }

          // Validate each document
          for (const doc of documentsToValidate) {
            totalCount++;

            const schemaRef = doc.schemaRef;
            if (!schemaRef) {
              warningCount++;
              if (opts.verbose) {
                console.log(
                  colorize(`⚠ ${doc.type}/${doc.id}: No schemaRef`, "yellow", process.stdout)
                );
              }
              continue;
            }

            const result = validator.validate(doc, schemaRef, "strict");

            if (!result.ok) {
              errorCount++;
              console.log(
                colorize(`✗ ${doc.type}/${doc.id}: Validation failed`, "red", process.stderr)
              );
              for (const error of result.errors) {
                console.log(`  ${error.pointer}: ${error.message}`);
              }
            } else if (opts.verbose) {
              console.log(colorize(`✓ ${doc.type}/${doc.id}: Valid`, "green", process.stdout));
            }
          }

          // Summary
          if (!opts.quiet) {
            console.log(`\nValidation complete:`);
            console.log(`  Total: ${totalCount}`);
            console.log(`  Valid: ${totalCount - errorCount - warningCount}`);
            if (warningCount > 0) {
              console.log(colorize(`  Warnings: ${warningCount}`, "yellow", process.stdout));
            }
            if (errorCount > 0) {
              console.log(colorize(`  Errors: ${errorCount}`, "red", process.stderr));
            }
          }

          // Throw if validation failed (allows cleanup to run)
          if (errorCount > 0) {
            throw new CliError("Document validation failed", { exitCode: 1 });
          }
        } catch (err) {
          if (err instanceof CliError) {
            throw err;
          }
          throw new CliError(`Failed to validate documents: ${(err as Error).message}`, {
            exitCode: 1,
          });
        } finally {
          if (storeInstance) {
            await storeInstance.close();
          }
        }
      });
    });

  return schema;
}

// Import fs functions
import { readdir, lstat } from "fs/promises";
import { join } from "path";
