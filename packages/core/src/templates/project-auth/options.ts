import { organization } from "better-auth/plugins";

export const projectAuthBasePath = "/api/auth";

/**
 * Better Auth includes this prefix in every auth cookie name. Browsers scope
 * localhost cookies without separating ports, so a distinct prefix prevents
 * Sapporta projects on different development ports from replacing one
 * another's sessions. Keep the value stable to preserve active sessions.
 */
export const projectAuthCookiePrefix = "%%SAPPORTA:AUTH_COOKIE_PREFIX%%";

export const projectAuthDrizzleAdapterConfig = {
  provider: "sqlite",
  camelCase: true,
} as const;

export function createProjectAuthEmailAndPasswordOptions(
  requireEmailVerification: boolean,
  sendResetPassword: (data: {
    user: { email: string; name?: string | null };
    url: string;
    token: string;
  }) => Promise<void>,
) {
  return {
    enabled: true,
    requireEmailVerification,
    sendResetPassword,
  };
}

export function createProjectAuthPlugins() {
  return [organization()];
}
