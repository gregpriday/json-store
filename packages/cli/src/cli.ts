#!/usr/bin/env node

/**
 * JSON Store CLI entry point
 */

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { FormatTarget, Store } from "@jsonstore/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

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
  .option("--check", "Check formatting without writing (exit 1 if changes needed)")
  .option("--dir <path>", "Data directory path", "./data")
  .argument("[type]", "Type to format")
  .argument("[id]", "Specific document ID to format")
  .action(async (type, id, options) => {
    const { openStore } = await import("@jsonstore/sdk");

    let store: Store | null = null;
    let exitCode = 0;
    let target: FormatTarget | undefined;

    if (options.all) {
      target = { all: true };
    } else if (type && id) {
      target = { type, id };
    } else if (type) {
      target = { type };
    } else {
      console.error("Error: Specify --all, <type>, or <type> <id>");
      process.exitCode = 1;
      return;
    }

    try {
      store = openStore({ root: options.dir });

      const count = await store.format(target, {
        dryRun: Boolean(options.check),
        failFast: true,
      });

      if (options.check) {
        if (count > 0) {
          console.log(`✗ ${count} document(s) need formatting`);
          exitCode = 1;
        } else {
          console.log("✓ All documents are properly formatted");
        }
      } else {
        if (count > 0) {
          console.log(`✓ Formatted ${count} document(s)`);
        } else {
          console.log("✓ All documents already canonical");
        }
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(`Error: ${message}`);
      exitCode = 1;
    } finally {
      if (store) {
        try {
          await store.close();
        } catch (closeErr: any) {
          const closeMessage = closeErr?.message ?? String(closeErr);
          console.error(`Error closing store: ${closeMessage}`);
          exitCode = exitCode === 0 ? 1 : exitCode;
        }
      }
    }

    process.exitCode = exitCode;
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
  .action(async (_options) => {
    console.log("Getting statistics");
    // Implementation will be added in later stages
    console.log("Not implemented yet");
  });

// Parse and execute
program.parse();
