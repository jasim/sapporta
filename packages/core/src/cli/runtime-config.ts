import { ErrorCode, OperationError } from "../errors.js";

const DEFAULT_API_URL = "http://localhost:3000";

export type OutputFormat = "table" | "json";

export interface CliRuntimeConfig {
  apiUrl: string;
  apiToken?: string;
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
    apiUrl: resolveApiUrl(flags, env),
    ...resolveApiToken(flags, env),
    output: resolveOutputFormat(flags, env, terminal),
  };
}

function resolveApiUrl(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
): string {
  const apiUrl =
    readString(flags.apiUrl) ??
    readString(env.SAPPORTA_API_URL) ??
    DEFAULT_API_URL;

  return apiUrl.replace(/\/+$/, "");
}

function resolveApiToken(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
): { apiToken?: string } {
  const token =
    readString(flags.apiToken) ?? readString(env.SAPPORTA_API_TOKEN);

  return token ? { apiToken: token } : {};
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
