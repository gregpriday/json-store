/**
 * Structured logging to stderr for MCP server observability
 * All logs go to stderr since stdout is reserved for MCP protocol
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  ts: string;
  level: LogLevel;
  event: string;
  tool?: string;
  duration_ms?: number;
  err_code?: string;
  err_message?: string;
  [key: string]: any;
}

export class Logger {
  #minLevel: LogLevel;

  constructor(minLevel: LogLevel = "info") {
    this.#minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const minIndex = levels.indexOf(this.#minLevel);
    const currentIndex = levels.indexOf(level);
    return currentIndex >= minIndex;
  }

  private log(level: LogLevel, event: string, data?: Record<string, any>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEvent: LogEvent = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    };

    // Always use stderr to avoid polluting stdout (MCP protocol channel)
    console.error(JSON.stringify(logEvent));
  }

  debug(event: string, data?: Record<string, any>): void {
    this.log("debug", event, data);
  }

  info(event: string, data?: Record<string, any>): void {
    this.log("info", event, data);
  }

  warn(event: string, data?: Record<string, any>): void {
    this.log("warn", event, data);
  }

  error(event: string, data?: Record<string, any>): void {
    this.log("error", event, data);
  }

  // Helper for tool execution logging
  toolCall(tool: string, duration_ms: number, success: boolean, err?: Error): void {
    if (success) {
      this.info("tool.success", { tool, duration_ms });
    } else {
      this.error("tool.error", {
        tool,
        duration_ms,
        err_code: (err as any)?.code || "UNKNOWN",
        err_message: err?.message || String(err),
      });
    }
  }
}

// Singleton logger instance
export const logger = new Logger(
  process.env.LOG_LEVEL === "debug" ? "debug" : "info"
);
