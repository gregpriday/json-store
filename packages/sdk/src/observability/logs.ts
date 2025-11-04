/**
 * Structured logging for index operations
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  type?: string;
  field?: string;
  message?: string;
  details?: Record<string, unknown>;
}

class Logger {
  #enabled = true;

  /**
   * Log an event
   */
  log(level: LogLevel, event: string, data?: Partial<LogEntry>): void {
    if (!this.#enabled) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data,
    };

    // Format for console output
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${event}]`;
    const parts = [prefix];

    if (entry.type || entry.field) {
      parts.push(`${entry.type ?? ""}/${entry.field ?? ""}`);
    }

    if (entry.message) {
      parts.push(entry.message);
    }

    if (entry.details) {
      parts.push(JSON.stringify(entry.details));
    }

    // Route to appropriate console method
    switch (level) {
      case "debug":
        if (process.env.JSONSTORE_DEBUG) {
          console.debug(parts.join(" "));
        }
        break;
      case "info":
        console.log(parts.join(" "));
        break;
      case "warn":
        console.warn(parts.join(" "));
        break;
      case "error":
        console.error(parts.join(" "));
        break;
    }
  }

  debug(event: string, data?: Partial<LogEntry>): void {
    this.log("debug", event, data);
  }

  info(event: string, data?: Partial<LogEntry>): void {
    this.log("info", event, data);
  }

  warn(event: string, data?: Partial<LogEntry>): void {
    this.log("warn", event, data);
  }

  error(event: string, data?: Partial<LogEntry>): void {
    this.log("error", event, data);
  }

  /**
   * Enable/disable logging
   */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();
