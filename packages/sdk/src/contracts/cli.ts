/**
 * CLI contracts and exit codes
 */

/**
 * Standard exit codes
 */
export const EXIT_CODE = {
  /** Success */
  SUCCESS: 0,
  /** Internal error */
  INTERNAL_ERROR: 1,
  /** Document not found */
  NOT_FOUND: 2,
  /** Invalid arguments */
  INVALID_ARGS: 3,
} as const;

/**
 * CLI result wrapper for --json mode
 */
export interface CliResult<T = unknown> {
  /** Whether operation succeeded */
  ok: boolean;
  /** Result data (if ok: true) */
  data?: T;
  /** Error message (if ok: false) */
  error?: string;
  /** Error code (if ok: false) */
  code?: keyof typeof EXIT_CODE;
}

/**
 * CLI invariants:
 *
 * 1. Exit codes:
 *    - 0: Success (operation completed)
 *    - 1: Internal error (unexpected error, bug)
 *    - 2: Not found (document/type doesn't exist)
 *    - 3: Invalid arguments (validation failed)
 *
 * 2. Output format:
 *    - --json flag: all output is valid JSON
 *    - Without --json: human-readable format
 *    - Errors always go to stderr
 *
 * 3. Environment:
 *    - DATA_ROOT: override default data directory
 *    - Tests must isolate DATA_ROOT per test
 *
 * 4. Idempotency:
 *    - put: same key+doc = no change
 *    - remove: removing non-existent doc succeeds (no-op)
 *    - init: multiple inits are safe
 */
