/**
 * I/O helpers for CLI
 */

import * as fs from "node:fs/promises";
import { parseJson } from "./arg.js";

/**
 * Read from stdin
 */
export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Read JSON from a file
 */
export async function readJsonFromFile(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, "utf8");
  return parseJson(content, `file ${filePath}`);
}

/**
 * Write to stdout
 */
export function writeStdout(content: string): void {
  process.stdout.write(content);
}

/**
 * Write to stderr
 */
export function writeStderr(content: string): void {
  process.stderr.write(content);
}

/**
 * Check if stdin is a TTY (interactive terminal)
 */
export function isStdinTTY(): boolean {
  return process.stdin.isTTY ?? false;
}
