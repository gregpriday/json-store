/**
 * Environment and configuration resolution
 */

import * as path from "node:path";
import { homedir } from "node:os";

/**
 * Expand tilde (~) to home directory
 */
function expandTilde(input: string): string {
  if (!input.startsWith("~")) {
    return input;
  }

  if (input === "~") {
    return homedir();
  }

  const match = input.match(/^~([\\/]|$)(.*)/);
  if (!match) {
    // Leave "~user" style references untouched for now.
    return input;
  }

  const rest = match[2] ?? "";
  return path.join(homedir(), rest);
}

/**
 * Resolve the store root directory
 * Priority: CLI option > JSONSTORE_ROOT env var > default "./data"
 */
export function resolveRoot(cliRoot?: string): string {
  const root = cliRoot ?? process.env.JSONSTORE_ROOT ?? "./data";
  return path.resolve(expandTilde(root));
}

/**
 * Check if running in verbose mode
 */
export function isVerbose(): boolean {
  return process.env.JSONSTORE_CLI_DEBUG === "1" || false;
}

/**
 * Check if output is a TTY
 */
export function isTTY(): boolean {
  return process.stdout.isTTY ?? false;
}
