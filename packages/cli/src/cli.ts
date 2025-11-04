#!/usr/bin/env node

/**
 * JSON Store CLI entry point
 */

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

/**
 * Format bytes to human-readable string
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.23 KB")
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const magnitude = Math.floor(Math.log(bytes) / Math.log(k));
  const i = Math.min(Math.max(magnitude, 0), sizes.length - 1);
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(2)} ${sizes[i]}`;
}

const program = new Command();

program
  .name("jsonstore")
  .description("JSON Store - Git-backed, file-based data store with Mango queries")
  .version(packageJson.version);

// Init command
program
  .command("init")
  .description("Initialize a new JSON store")
  .option("--dir <path>", "Data directory path", "./data")
  .action(async (options) => {
    console.log(`Initializing store at: ${options.dir}`);
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Put command
program
  .command("put <type> <id>")
  .description("Store or update a document")
  .option("--file <path>", "Read document from JSON file")
  .option("--data <json>", "Inline JSON document")
  .option("--git-commit <message>", "Commit change to git with message")
  .action(async (type, id, _options) => {
    console.log(`Putting ${type}/${id}`);
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Get command
program
  .command("get <type> <id>")
  .description("Retrieve a document")
  .option("--raw", "Output raw JSON without formatting")
  .action(async (type, id, _options) => {
    console.log(`Getting ${type}/${id}`);
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Remove command
program
  .command("rm <type> <id>")
  .description("Remove a document")
  .option("--force", "Force removal without confirmation")
  .option("--git-commit <message>", "Commit change to git with message")
  .action(async (type, id, _options) => {
    console.log(`Removing ${type}/${id}`);
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// List command
program
  .command("ls <type>")
  .description("List all document IDs for a type")
  .option("--json", "Output as JSON array")
  .action(async (type, _options) => {
    console.log(`Listing documents of type: ${type}`);
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Query command
program
  .command("query")
  .description("Query documents using Mango query language")
  .option("--file <path>", "Read query from JSON file")
  .option("--data <json>", "Inline JSON query")
  .option("--type <type>", "Restrict to specific type")
  .option("--limit <n>", "Maximum results", parseInt)
  .option("--skip <n>", "Skip N results", parseInt)
  .action(async (_options) => {
    console.log("Executing query");
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Format command
program
  .command("format")
  .description("Format documents to canonical representation")
  .option("--all", "Format all documents")
  .argument("[type]", "Type to format")
  .argument("[id]", "Specific document ID to format")
  .action(async (_type, _id, _options) => {
    console.log("Formatting documents");
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Ensure index command
program
  .command("ensure-index <type> <field>")
  .description("Create or update an equality index for fast lookups")
  .action(async (type, field) => {
    console.log(`Ensuring index on ${type}.${field}`);
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Reindex command
program
  .command("reindex <type>")
  .description("Rebuild indexes for a type")
  .argument("[fields...]", "Specific fields to reindex")
  .action(async (type, _fields) => {
    console.log(`Reindexing ${type}`);
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Stats command
program
  .command("stats")
  .description("Show statistics for the store or a type")
  .option("--type <type>", "Show stats for specific type")
  .option("--detailed", "Show detailed statistics with per-type breakdown")
  .option("--json", "Output as JSON for machine consumption")
  .action(async (options) => {
    // Check if stats are enabled via environment variable
    if (process.env.JSONSTORE_ENABLE_STATS === "0") {
      console.error("Stats command is disabled via JSONSTORE_ENABLE_STATS=0");
      process.exit(3);
    }

    let exitCode = 0;
    let store: Awaited<ReturnType<(typeof import("@jsonstore/sdk"))["openStore"]>> | undefined;

    try {
      const { openStore } = await import("@jsonstore/sdk");
      const storeInstance = openStore({ root: process.env.DATA_ROOT || "./data" });
      store = storeInstance;

      if (options.detailed) {
        const stats = await storeInstance.detailedStats();

        if (options.json) {
          console.log(JSON.stringify(stats));
        } else {
          console.log(`Documents: ${stats.count}`);
          console.log(`Total size: ${formatBytes(stats.bytes)}`);
          console.log(`Average size: ${formatBytes(stats.avgBytes)}`);
          console.log(`Min size: ${formatBytes(stats.minBytes)}`);
          console.log(`Max size: ${formatBytes(stats.maxBytes)}`);

          if (stats.types && Object.keys(stats.types).length > 0) {
            console.log("\nBy Type:");
            for (const [type, typeStats] of Object.entries(stats.types)) {
              console.log(`  ${type}: ${typeStats.count} docs, ${formatBytes(typeStats.bytes)}`);
            }
          }
        }
      } else {
        if (options.type && !/^[a-z0-9_.-]+$/i.test(options.type)) {
          console.error(
            `Invalid type name "${options.type}". Type names may only include letters, numbers, underscores, dashes, or dots.`
          );
          exitCode = 1;
          return;
        }

        const stats = await storeInstance.stats(options.type);

        if (options.json) {
          console.log(JSON.stringify(stats));
        } else {
          console.log(`Documents: ${stats.count}`);
          console.log(`Total size: ${formatBytes(stats.bytes)}`);
        }
      }
    } catch (err: any) {
      console.error(
        `Error getting statistics: ${err instanceof Error ? err.message : String(err)}`
      );
      exitCode = 1;
    } finally {
      if (store) {
        try {
          await store.close();
        } catch (closeErr: any) {
          console.error(
            `Error closing store: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`
          );
          exitCode = exitCode || 1;
        }
      }
      if (exitCode !== 0) process.exit(exitCode);
    }
  });

// Parse and execute
program.parse();
