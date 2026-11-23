export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  sessionId?: string;
  featureId?: string;
  taskId?: string;
  stage?: string;
  writeMode?: "preview" | "apply";
  safetyLevel?: "basic" | "strict" | "none";
  gitBranch?: string | null;
  gitCommit?: string | null;
  gitTag?: string | null;
  projectRoot?: string;
  source?: string;
  [key: string]: unknown;
}

export interface LogEvent extends LogContext {
  level: LogLevel;
  message: string;
  timestamp: string;
}

export function logEvent(level: LogLevel, message: string, context: LogContext = {}): void {
  const event: LogEvent = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };
  // Emit as single-line JSON for easy parsing
  console.log(JSON.stringify(event));
}

export interface Logger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

function logWith(level: LogLevel, prefix: string) {
  return (...args: any[]) => {
    if (!args.length) return;
    const [first, ...rest] = args;
    const message = typeof first === "string" ? first : JSON.stringify(first);
    const contextCandidate = rest[0];
    const context: LogContext =
      contextCandidate && typeof contextCandidate === "object" && !Array.isArray(contextCandidate)
        ? { ...contextCandidate }
        : {};
    logEvent(level, message, { ...context, source: prefix });
  };
}

export function createLogger(prefix: string): Logger {
  return {
    debug: logWith("debug", prefix),
    info: logWith("info", prefix),
    warn: logWith("warn", prefix),
    error: logWith("error", prefix),
  };
}
