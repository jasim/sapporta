import { organization } from "better-auth/plugins";

export const projectAuthBasePath = "/api/auth";

export const projectAuthDrizzleAdapterConfig = {
  provider: "sqlite",
  camelCase: true,
} as const;

export function createProjectAuthEmailAndPasswordOptions(
  requireEmailVerification: boolean,
) {
  return {
    enabled: true,
    requireEmailVerification,
  };
}

export function createProjectAuthPlugins() {
  return [organization()];
}
