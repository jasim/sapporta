import { ErrorCode, OperationError } from "../errors.js";

const DEFAULT_API_URL = "http://localhost:3000";

export type OutputFormat = "table" | "json";

/**
 * Which setting chose the API URL, and which chose the token.
 *
 * A stale `SAPPORTA_API_URL` and the built-in default produce identical
 * requests, so a failure that names only the URL still leaves the user
 * guessing where it came from. The same holds for a token that was never set.
 */
export type ApiUrlSource = "flag" | "env" | "default";
export type ApiTokenSource = "flag" | "env" | "none";

/** The deployment an API-backed command talks to, and how it was chosen. */
export interface ApiTarget {
  apiUrl: string;
  apiUrlSource: ApiUrlSource;
  apiToken?: string;
  apiTokenSource: ApiTokenSource;
}

export interface CliRuntimeConfig extends ApiTarget {
  output: OutputFormat;
}

export interface TerminalInfo {
  isTTY?: boolean;
}

/**
 * Resolves process-level CLI configuration once at the command boundary.
 *
 * Flags are explicit one-off overrides. Environment variables are the stable
 * automation interface, especially for credentials injected into an agent
 * session outside the visible command text.
 */
export function resolveCliRuntimeConfig(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
  terminal: TerminalInfo = process.stdout,
): CliRuntimeConfig {
  return {
    ...resolveApiUrl(flags, env),
    ...resolveApiToken(flags, env),
    output: resolveOutputFormat(flags, env, terminal),
  };
}

function resolveApiUrl(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
): { apiUrl: string; apiUrlSource: ApiUrlSource } {
  const flagUrl = readString(flags.apiUrl);
  if (flagUrl) {
    return { apiUrl: trimTrailingSlashes(flagUrl), apiUrlSource: "flag" };
  }

  const envUrl = readString(env.SAPPORTA_API_URL);
  if (envUrl) {
    return { apiUrl: trimTrailingSlashes(envUrl), apiUrlSource: "env" };
  }

  return { apiUrl: DEFAULT_API_URL, apiUrlSource: "default" };
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolveApiToken(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
): { apiToken?: string; apiTokenSource: ApiTokenSource } {
  const flagToken = readString(flags.apiToken);
  if (flagToken) return { apiToken: flagToken, apiTokenSource: "flag" };

  const envToken = readString(env.SAPPORTA_API_TOKEN);
  if (envToken) return { apiToken: envToken, apiTokenSource: "env" };

  return { apiTokenSource: "none" };
}

function resolveOutputFormat(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
  terminal: TerminalInfo,
): OutputFormat {
  const explicit =
    readString(flags.output) ?? readString(env.SAPPORTA_OUTPUT_FORMAT);
  if (explicit === "json") return "json";
  if (explicit === "table") return "table";
  if (explicit !== undefined) {
    throw new OperationError(
      `--output must be table or json, got ${JSON.stringify(explicit)}`,
      ErrorCode.VALIDATION_FAILED,
    );
  }
  return terminal.isTTY === true ? "table" : "json";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
