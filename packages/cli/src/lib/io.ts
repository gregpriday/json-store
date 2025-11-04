/**
 * I/O helpers for CLI
 */

import * as fs from "node:fs/promises";
import { parseJson } from "./arg.js";

/**
 * Read from stdin with size limit (default 10MB)
 * @param maxBytes - Maximum bytes to read (default 10MB)
 * @throws Error if input exceeds size limit
 */
export async function readStdin(maxBytes = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytesRead = 0;
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk) => {
      bytesRead += Buffer.byteLength(chunk, "utf8");

      // Enforce size limit during streaming to prevent memory exhaustion
      if (bytesRead > maxBytes) {
        process.stdin.pause();
        process.stdin.removeAllListeners();
        reject(new Error(`stdin too large (max ${Math.floor(maxBytes / (1024 * 1024))}MB)`));
        return;
      }

      data += chunk;
    });

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
