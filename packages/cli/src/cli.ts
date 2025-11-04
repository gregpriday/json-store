#!/usr/bin/env node

/**
 * JSON Store CLI entry point
 */

import { Command, InvalidArgumentError } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createInterface } from "readline/promises";
import type { QuerySpec, FormatTarget } from "@jsonstore/sdk";
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
  .option("--check", "Check formatting without writing (exit 1 if changes needed)")
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

      let target: FormatTarget;
      if (options.all) {
        target = { all: true };
      } else if (type && id) {
        target = { type, id };
      } else {
        target = { type };
      }

      const count = await store.format(target, {
        dryRun: Boolean(options.check),
        failFast: true,
      });

      if (options.check) {
        if (count > 0) {
          if (!opts.quiet) {
            console.log(`✗ ${count} document(s) need formatting`);
          }
          throw new CliError("Formatting check failed", { exitCode: 1 });
        } else {
          if (!opts.quiet) {
            console.log("✓ All documents are properly formatted");
          }
        }
      } else {
        if (!opts.quiet) {
          if (count > 0) {
            console.log(`✓ Formatted ${count} document(s)`);
          } else {
            console.log("✓ All documents already canonical");
          }
        }
      }
    });
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
      const storeInstance = openStore({ root: resolveRoot() });
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
