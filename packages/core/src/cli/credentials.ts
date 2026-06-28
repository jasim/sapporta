/**
 * Deployment and credential selection for stateless CLI calls.
 *
 * A Sapporta token is meaningful only for the API URL that issued it. The CLI
 * therefore resolves the deployment (`apiUrl`) and token together for every
 * invocation instead of relying on a hidden active profile. Automation should
 * prefer `SAPPORTA_API_URL` and `SAPPORTA_API_TOKEN`; one-off commands can use
 * `--api-url` and `--api-token` to make the target explicit.
 */
export interface CliCredentials {
  apiUrl: string;
  apiToken?: string;
}

export function resolveCliCredentials(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): CliCredentials {
  return {
    apiUrl: resolveApiUrl(flags, env),
    ...resolveApiToken(flags, env),
  };
}

export function resolveApiUrl(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit =
    readScalarFlag(flags.apiUrl) ?? readScalarFlag(flags["api-url"]);
  const apiUrl = explicit ?? env.SAPPORTA_API_URL ?? "http://localhost:3000";
  return apiUrl.replace(/\/+$/, "");
}

export function resolveApiToken(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): { apiToken?: string } {
  const explicit =
    readScalarFlag(flags.apiToken) ?? readScalarFlag(flags["api-token"]);
  const token = explicit ?? env.SAPPORTA_API_TOKEN;
  return token && token.length > 0 ? { apiToken: token } : {};
}

function readScalarFlag(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
