import type { HealthPolicy } from "@sapporta/server";

export interface ProjectAuthEnv {
  secret: string;
  requireVerifiedEmail: boolean;
  healthPolicy: HealthPolicy;
  frontendOrigins: string[];
}

export function readProjectAuthEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProjectAuthEnv {
  return {
    secret: readAuthSecret(env),
    requireVerifiedEmail: env.SAPPORTA_REQUIRE_VERIFIED_EMAIL !== "false",
    healthPolicy: readHealthPolicy(env.SAPPORTA_HEALTH_POLICY),
    frontendOrigins: readOrigins(env.SAPPORTA_FRONTEND_ORIGINS),
  };
}

function readAuthSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.BETTER_AUTH_SECRET ?? env.SAPPORTA_AUTH_SECRET;
  if (secret) return secret;
  throw new Error("Project auth requires BETTER_AUTH_SECRET or SAPPORTA_AUTH_SECRET.");
}

function readHealthPolicy(value: string | undefined): HealthPolicy {
  if (value === "disabled" || value === "authenticated" || value === "public") {
    return value;
  }
  return "public";
}

function readOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
