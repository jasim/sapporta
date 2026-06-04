import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { ProjectDbConnection } from "@sapporta/server";
import { betterAuth } from "better-auth";
import type { ProjectAuthEnv } from "./env.js";
import {
  createProjectAuthEmailAndPasswordOptions,
  createProjectAuthPlugins,
  projectAuthBasePath,
  projectAuthDrizzleAdapterConfig,
} from "./options.js";
import * as authSchema from "./schema.js";

export interface BetterAuthSessionApi {
  getSession: (context: {
    headers: Headers;
    query?: {
      disableCookieCache?: boolean;
      disableRefresh?: boolean;
    };
  }) => Promise<unknown>;
}

export interface ProjectBetterAuth {
  handler: (request: Request) => Promise<Response>;
  api: BetterAuthSessionApi;
}

export interface CreateBetterAuthOptions {
  conn: ProjectDbConnection;
  env: ProjectAuthEnv;
}

export function createBetterAuth({
  conn,
  env,
}: CreateBetterAuthOptions): ProjectBetterAuth {
  const auth: ProjectBetterAuth = betterAuth({
    basePath: projectAuthBasePath,
    secret: env.secret,
    trustedOrigins: env.frontendOrigins,
    database: drizzleAdapter(conn.db, {
      schema: authSchema,
      ...projectAuthDrizzleAdapterConfig,
    }),
    emailAndPassword: createProjectAuthEmailAndPasswordOptions(
      env.requireVerifiedEmail,
    ),
    plugins: createProjectAuthPlugins(),
  });

  return auth;
}
