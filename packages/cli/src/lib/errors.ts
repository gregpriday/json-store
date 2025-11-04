/**
 * CLI error handling and exit code mapping
 */

/**
 * Base CLI error class
 */
export class CliError extends Error {
  exitCode: number;

  constructor(message: string, options?: { exitCode?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "CliError";
    this.exitCode = options?.exitCode ?? 1;
  }
}

/**
 * Map SDK errors to CLI exit codes
 * - 0: success
 * - 1: usage/validation/IO/unknown error
 * - 2: document not found
 */
export function mapSdkErrorToExitCode(error: unknown): number {
  // Check for CliError first (has exitCode property)
  if (error instanceof CliError) {
    return error.exitCode;
  }

  if (error instanceof Error) {
    const name = error.name || error.constructor.name;

    // Not found errors -> exit code 2
    if (name === "DocumentNotFoundError" || name === "NotFoundError") {
      return 2;
    }

    // Validation and argument errors -> exit code 1
    if (
      name === "ValidationError" ||
      name === "InvalidArgumentError" ||
      name === "DocumentReadError" ||
      name === "DocumentWriteError" ||
      name === "DocumentRemoveError" ||
      name === "DirectoryError" ||
      name === "ListFilesError" ||
      name === "JSONStoreError"
    ) {
      return 1;
    }
  }

  // Default to exit code 1 for unknown errors
  return 1;
}

/**
 * Format an error for CLI output
 */
export function formatCliError(error: unknown, verbose = false): string {
  if (error instanceof Error) {
    let message = error.message;

    // Redact large payloads from error messages
    if (message.length > 2000) {
      message = message.substring(0, 2000) + "... (truncated)";
    }

    if (verbose && error.cause) {
      message += `\n  Cause: ${error.cause}`;
    }

    if (verbose && error.stack) {
      message += `\n${error.stack}`;
    }

    return message;
  }

  return String(error);
}
