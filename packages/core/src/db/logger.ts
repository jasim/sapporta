import winston from "winston";
import type { MiddlewareHandler } from "hono";

const { combine, timestamp, printf, json } = winston.format;

type LogFields = Record<string, unknown>;

export type SapportaLogger = {
  child(fields: LogFields): SapportaLogger;
  debug(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  http(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
};

/**
 * Human-readable format for development.
 *
 * Output: `2026-03-11 14:32:01 info [runtime] Booting project project=playground`
 */
const devFormat = printf(({ level, message, module, timestamp, ...rest }) => {
  const mod = module ? ` [${module}]` : "";
  const extras = Object.keys(rest).length > 0
    ? " " + Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")
    : "";
  return `${timestamp} ${level}${mod} ${message}${extras}`;
});

/**
 * Create a Winston logger instance.
 *
 * Reads from environment:
 * - `LOG_FORMAT` — `"json"` for structured JSON, anything else for human-readable (default)
 * - `LOG_LEVEL` — Winston level threshold. Default: `"debug"`
 */
export function createLogger(): SapportaLogger {
  const isJson = process.env.LOG_FORMAT === "json";
  const level = process.env.LOG_LEVEL ?? "debug";

  return winston.createLogger({
    level,
    format: combine(
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      isJson ? json() : devFormat,
    ),
    transports: [new winston.transports.Console()],
  }) as SapportaLogger;
}

/** Singleton logger instance. Modules use `logger.child({ module: "name" })`. */
export const logger = createLogger();

/**
 * Hono middleware that replaces `hono/logger`.
 *
 * Logs each request/response at the `http` level with method, path, status, and duration.
 * Does NOT read the request body — that's the handler's job.
 */
export function requestLogger(): MiddlewareHandler {
  const log = logger.child({ module: "http" });

  return async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    log.http("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: `${duration}ms`,
    });
  };
}
