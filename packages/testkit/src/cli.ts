/**
 * CLI testing utilities
 */

import { execa } from "execa";

/**
 * Result of a CLI command execution
 */
export interface CliResult {
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Exit code (null if process was killed by signal) */
  exitCode: number | null;
  /** Terminating signal when the process didn't exit normally */
  signal: NodeJS.Signals | null;
}

/**
 * Options for CLI execution
 */
export interface CliExecOptions {
  /** Current working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Input to pass to stdin */
  input?: string;
  /** Don't reject on non-zero exit (default: false) */
  reject?: boolean;
}

/**
 * Execute a CLI command using execa
 * @param cliPath - Path to CLI executable
 * @param args - Command arguments
 * @param options - Execution options
 * @returns CLI result with stdout, stderr, exitCode
 */
export async function runCli(
  cliPath: string,
  args: string[],
  options: CliExecOptions = {}
): Promise<CliResult> {
  const { cwd, env, input, reject = false } = options;

  try {
    const result = await execa("node", [cliPath, ...args], {
      cwd,
      env: { ...process.env, ...env },
      input,
      reject,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
    };
  } catch (error: any) {
    // If reject is false, return the error result
    if (!reject && error.exitCode !== undefined) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        exitCode: error.exitCode ?? null,
        signal: error.signal ?? null,
      };
    }
    throw error;
  }
}

/**
 * Parse JSON output from CLI
 * @param stdout - Standard output from CLI
 * @returns Parsed JSON object
 */
export function parseJsonOutput<T = unknown>(stdout: string): T {
  return JSON.parse(stdout.trim());
}
