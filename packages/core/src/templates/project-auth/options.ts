import { organization } from "better-auth/plugins";

export const projectAuthBasePath = "/api/auth";

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
