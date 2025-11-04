#!/usr/bin/env node

/**
 * JSON Store CLI entry point
 */

import { Command, InvalidArgumentError } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createInterface } from "readline/promises";
import type { QuerySpec } from "@jsonstore/sdk";
import { openCliStore } from "./lib/store.js";
import { resolveRoot } from "./lib/env.js";
import { parseNonNegativeInt, parseJson } from "./lib/arg.js";
import { readStdin, readJsonFromFile, isStdinTTY } from "./lib/io.js";
import { printJson, printLines, colorize } from "./lib/render.js";
import { CliError, mapSdkErrorToExitCode, formatCliError } from "./lib/errors.js";
import { withTiming } from "./lib/telemetry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

const program = new Command();

// Configure error output with color
program
  .configureOutput({
    writeErr: (str) => process.stderr.write(colorize(str, "red", process.stderr)),
  })
  .exitOverride((err) => {
    if (err.code !== "commander.help" && err.code !== "commander.version") {
      console.error(`\nError: ${err.message}`);
      process.exit(err.exitCode);
    }
    throw err;
  });

// Global options
program
  .name("jsonstore")
  .description("JSON Store - Git-backed, file-based data store with Mango queries")
  .version(packageJson.version)
  .option("--root <path>", "Data directory root")
  .option("--verbose", "Verbose diagnostics")
  .option("--quiet", "Suppress non-error output");

// Init command
program
  .command("init")
  .description("Initialize a new JSON store")
  .action(async () => {
    await withTiming("cli.init", async () => {
      const opts = program.opts();
      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      await store.init();

      if (!opts.quiet) {
        console.log(`Initialized store at ${root}`);
      }
    });
  });

// Put command
program
  .command("put <type> <id>")
  .description("Store or update a document")
  .option("--file <path>", "Read document from JSON file")
  .option("--data <json>", "Inline JSON document")
  .option("--git-commit <message>", "Commit change to git with message")
  .action(async (type, id, options) => {
    await withTiming("cli.put", async () => {
      const opts = program.opts();

      // Validate mutual exclusivity
      const sources = [options.file, options.data].filter(Boolean);
      if (sources.length > 1) {
        throw new InvalidArgumentError(
          "Cannot use both --file and --data; choose one or use stdin"
        );
      }

      // Get document from file, data, or stdin
      let doc: unknown;
      if (options.file) {
        doc = await readJsonFromFile(options.file);
      } else if (options.data) {
        doc = parseJson(options.data, "--data");
      } else {
        // Read from stdin
        if (isStdinTTY()) {
          throw new InvalidArgumentError(
            "No input provided. Use --file, --data, or pipe JSON to stdin"
          );
        }
        let stdin: string;
        try {
          stdin = await readStdin(); // Size limit enforced during streaming
        } catch (err) {
          throw new InvalidArgumentError(
            err instanceof Error ? err.message : "Failed to read from stdin"
          );
        }
        if (!stdin.trim()) {
          throw new InvalidArgumentError("stdin is empty");
        }
        doc = parseJson(stdin, "stdin");
      }

      // Store document
      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      await store.put({ type, id }, doc, { gitCommit: options.gitCommit });

      if (!opts.quiet) {
        console.log(`Stored ${type}/${id}`);
      }
    });
  });

// Get command
program
  .command("get <type> <id>")
  .description("Retrieve a document")
  .option("--raw", "Output raw JSON without formatting")
  .action(async (type, id, options) => {
    await withTiming("cli.get", async () => {
      const opts = program.opts();
      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      const doc = await store.get({ type, id });

      if (doc === null || doc === undefined) {
        throw new CliError(`Document not found: ${type}/${id}`, {
          exitCode: 2,
        });
      }

      printJson(doc, { raw: options.raw });
    });
  });

// Remove command
program
  .command("rm <type> <id>")
  .description("Remove a document")
  .option("--force", "Force removal without confirmation")
  .option("--git-commit <message>", "Commit change to git with message")
  .action(async (type, id, options) => {
    await withTiming("cli.rm", async () => {
      const opts = program.opts();

      // Require confirmation unless --force
      if (!options.force) {
        if (isStdinTTY()) {
          // Interactive prompt
          const rl = createInterface({
            input: process.stdin,
            output: process.stderr,
          });
          const answer = (await rl.question(`Remove ${type}/${id}? (y/N) `)).trim().toLowerCase();
          rl.close();

          if (answer !== "y") {
            throw new CliError("Aborted by user", { exitCode: 1 });
          }
        } else {
          // Non-TTY requires --force
          throw new InvalidArgumentError("Use --force to confirm removal in non-interactive mode");
        }
      }

      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      await store.remove({ type, id }, { gitCommit: options.gitCommit });

      if (!opts.quiet) {
        console.log(`Removed ${type}/${id}`);
      }
    });
  });

// List command
program
  .command("ls <type>")
  .description("List all document IDs for a type")
  .option("--json", "Output as JSON array")
  .option("--limit <n>", "Maximum number of results", (val) => parseNonNegativeInt(val, "--limit"))
  .action(async (type, options) => {
    await withTiming("cli.ls", async () => {
      const opts = program.opts();
      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      let ids = await store.list(type);

      // Apply limit if specified
      if (options.limit !== undefined) {
        ids = ids.slice(0, options.limit);
      }

      if (options.json) {
        printJson(ids);
      } else {
        printLines(ids);
      }
    });
  });

// Query command
program
  .command("query")
  .description("Query documents using Mango query language")
  .option("--file <path>", "Read query from JSON file")
  .option("--data <json>", "Inline JSON query")
  .option("--type <type>", "Restrict to specific type")
  .option("--limit <n>", "Maximum results", (val) => parseNonNegativeInt(val, "--limit"))
  .option("--skip <n>", "Skip N results", (val) => parseNonNegativeInt(val, "--skip"))
  .action(async (options) => {
    await withTiming("cli.query", async () => {
      const opts = program.opts();

      // Validate mutual exclusivity
      const sources = [options.file, options.data].filter(Boolean);
      if (sources.length > 1) {
        throw new InvalidArgumentError(
          "Cannot use both --file and --data; choose one or use stdin"
        );
      }

      // Get query spec from file, data, or stdin
      let rawQuery: unknown;
      if (options.file) {
        rawQuery = await readJsonFromFile(options.file);
      } else if (options.data) {
        rawQuery = parseJson(options.data, "--data");
      } else {
        // Read from stdin
        if (isStdinTTY()) {
          throw new InvalidArgumentError(
            "No input provided. Use --file, --data, or pipe JSON to stdin"
          );
        }
        let stdin: string;
        try {
          stdin = await readStdin(); // Size limit enforced during streaming
        } catch (err) {
          throw new InvalidArgumentError(
            err instanceof Error ? err.message : "Failed to read from stdin"
          );
        }
        if (!stdin.trim()) {
          throw new InvalidArgumentError("stdin is empty");
        }
        rawQuery = parseJson(stdin, "stdin");
      }

      // Validate query is an object
      if (rawQuery === null || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
        throw new InvalidArgumentError("Query must be a JSON object");
      }

      const querySpec = rawQuery as QuerySpec;

      // Override with CLI options
      if (options.type !== undefined) {
        querySpec.type = options.type;
      }
      if (options.limit !== undefined) {
        querySpec.limit = options.limit;
      }
      if (options.skip !== undefined) {
        querySpec.skip = options.skip;
      }

      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      const results = await store.query(querySpec);

      // Always output as JSON array
      printJson(results);
    });
  });

// Format command
program
  .command("format [type] [id]")
  .description("Format documents to canonical representation")
  .option("--all", "Format all documents")
  .action(async (type, id, options) => {
    await withTiming("cli.format", async () => {
      const opts = program.opts();

      // Validate scope selection
      if (options.all && (type || id)) {
        throw new InvalidArgumentError("Cannot use --all with [type] or [id]");
      }

      if (id && !type) {
        throw new InvalidArgumentError("Cannot specify [id] without [type]");
      }

      if (!options.all && !type) {
        throw new InvalidArgumentError("Specify --all, <type>, or <type> <id>");
      }

      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      if (options.all) {
        await store.format({ all: true });
        if (!opts.quiet) {
          console.log("Formatted all documents");
        }
      } else if (type && id) {
        await store.format({ type, id });
        if (!opts.quiet) {
          console.log(`Formatted ${type}/${id}`);
        }
      } else if (type) {
        await store.format({ type });
        if (!opts.quiet) {
          console.log(`Formatted all ${type} documents`);
        }
      }
    });
  });

// Stats command
program
  .command("stats")
  .description("Show statistics for the store or a type")
  .option("--type <type>", "Show stats for specific type")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    await withTiming("cli.stats", async () => {
      const opts = program.opts();
      const root = resolveRoot(opts.root);
      const store = openCliStore(root);

      const stats = await store.stats(options.type);

      if (options.json) {
        printJson(stats);
      } else {
        console.log(`Documents: ${stats.count}`);
        console.log(`Total size: ${(stats.bytes / 1024).toFixed(2)} KB`);
      }
    });
  });

// Top-level error handler
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const opts = program.opts();
    const exitCode = mapSdkErrorToExitCode(err);
    const message = formatCliError(err, opts.verbose);

    // Write error to stderr without color in JSON/raw modes
    console.error(`Error: ${message}`);

    process.exit(exitCode);
  }
}

main();
