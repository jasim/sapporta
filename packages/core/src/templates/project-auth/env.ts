import type { HealthPolicy } from "@sapporta/server";

export type Origin = string & { readonly __origin: unique symbol };
export type PublicBaseUrl = Origin & {
  readonly __publicBaseUrl: unique symbol;
};

export interface ProjectAuthEnv {
  port: number;
  betterAuthSecret: string;
  publicBaseUrl: PublicBaseUrl;
  trustedOrigins: Origin[];
  requireVerifiedEmail: boolean;
  healthPolicy: HealthPolicy;
  mail: ProjectMailConfig;
}

export type MailTransportKind = "stream" | "smtp" | "disabled";

export type ProjectMailConfig =
  | {
      from: string;
      transport: "stream" | "disabled";
    }
  | {
      from: string;
      transport: "smtp";
      smtp: ProjectSmtpConfig;
    };

export type ProjectSmtpConfig =
  | { url: string }
  | {
      host: string;
      port: number;
      secure: boolean;
      auth?: { user: string; pass: string };
    };

export function readProjectAuthEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProjectAuthEnv {
  const publicBaseUrl = readRequiredPublicBaseUrl(env);
  return {
    port:
      env.PORT === undefined || env.PORT === ""
        ? 3000
        : parseIntegerEnv(env.PORT, "PORT"),
    betterAuthSecret: readRequiredEnv(env, "BETTER_AUTH_SECRET"),
    publicBaseUrl,
    trustedOrigins: readTrustedOrigins(env, publicBaseUrl),
    requireVerifiedEmail: readBooleanEnv(
      env.SAPPORTA_REQUIRE_VERIFIED_EMAIL,
      "SAPPORTA_REQUIRE_VERIFIED_EMAIL",
      true,
    ),
    healthPolicy: readHealthPolicy(env.SAPPORTA_HEALTH_POLICY),
    mail: readMailConfig(env),
  };
}

function readMailConfig(env: NodeJS.ProcessEnv): ProjectMailConfig {
  const from = readRequiredEnv(env, "SAPPORTA_MAIL_FROM");
  const transport = readMailTransport(env.SAPPORTA_MAIL_TRANSPORT);

  if (transport === "stream" || transport === "disabled") {
    return { from, transport };
  }

  return {
    from,
    transport,
    smtp: readSmtpConfig(env),
  };
}

function readMailTransport(value: string | undefined): MailTransportKind {
  if (value === undefined || value === "") return "stream";
  if (value === "stream" || value === "smtp" || value === "disabled") {
    return value;
  }
  throw new Error(
    'SAPPORTA_MAIL_TRANSPORT must be "stream", "smtp", or "disabled".',
  );
}

function readSmtpConfig(env: NodeJS.ProcessEnv): ProjectSmtpConfig {
  if (env.SMTP_URL) return { url: env.SMTP_URL };

  const host = readRequiredEnv(env, "SMTP_HOST");
  const port = readRequiredIntegerEnv(env, "SMTP_PORT");
  const secure = readBooleanEnv(env.SMTP_SECURE, "SMTP_SECURE", false);
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;

  return {
    host,
    port,
    secure,
    auth: user || pass ? { user: user ?? "", pass: pass ?? "" } : undefined,
  };
}

function readRequiredEnv(
  env: NodeJS.ProcessEnv,
  name: keyof NodeJS.ProcessEnv,
): string {
  const value = env[name];
  if (value) return value;
  throw new Error(`Project auth requires ${name}.`);
}

function readRequiredPublicBaseUrl(env: NodeJS.ProcessEnv): PublicBaseUrl {
  return parsePublicBaseUrl(readRequiredEnv(env, "SAPPORTA_PUBLIC_BASE_URL"));
}

function readBooleanEnv(
  value: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be "true" or "false".`);
}

function readHealthPolicy(value: string | undefined): HealthPolicy {
  if (value === undefined || value === "") return "public";
  if (value === "disabled" || value === "authenticated" || value === "public") {
    return value;
  }
  throw new Error(
    'SAPPORTA_HEALTH_POLICY must be "public", "authenticated", or "disabled".',
  );
}

function readTrustedOrigins(
  env: NodeJS.ProcessEnv,
  publicBaseUrl: PublicBaseUrl,
): Origin[] {
  return uniqueOrigins([
    parseOrigin(publicBaseUrl, "SAPPORTA_PUBLIC_BASE_URL"),
    ...readOrigins(env.SAPPORTA_FRONTEND_ORIGINS, "SAPPORTA_FRONTEND_ORIGINS"),
  ]);
}

function readOrigins(value: string | undefined, name: string): Origin[] {
  if (value === undefined || value === "") return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseOrigin(origin, name));
}

function readRequiredIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: keyof NodeJS.ProcessEnv,
): number {
  const value = readRequiredEnv(env, name);
  return parseIntegerEnv(value, String(name));
}

function parseIntegerEnv(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== value) {
    throw new Error(`${name} must be an integer.`);
  }
  return parsed;
}

function parsePublicBaseUrl(value: string): PublicBaseUrl {
  return parseOrigin(value, "SAPPORTA_PUBLIC_BASE_URL") as PublicBaseUrl;
}

function parseOrigin(value: string, name: string): Origin {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must contain valid URL origins.`);
  }

  if (url.origin !== value || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `${name} must contain origins only, such as https://app.example.com.`,
    );
  }
  return url.origin as Origin;
}

function uniqueOrigins(origins: Origin[]): Origin[] {
  return Array.from(new Set(origins));
}
