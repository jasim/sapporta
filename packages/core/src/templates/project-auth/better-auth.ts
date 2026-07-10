import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { ProjectDbConnection } from "@sapporta/server";
import { betterAuth } from "better-auth";
import type { SapportaMailer } from "../mailer.js";
import type { ProjectAuthEnv } from "./env.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./emails.js";
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
  mailer: SapportaMailer;
}

export function createBetterAuth({
  conn,
  env,
  mailer,
}: CreateBetterAuthOptions): ProjectBetterAuth {
  const auth: ProjectBetterAuth = betterAuth({
    basePath: projectAuthBasePath,
    baseURL: env.publicAppUrl,
    secret: env.betterAuthSecret,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(conn.db, {
      schema: authSchema,
      ...projectAuthDrizzleAdapterConfig,
    }),
    emailAndPassword: createProjectAuthEmailAndPasswordOptions(
      env.requireVerifiedEmail,
      (data) => sendPasswordResetEmail(mailer, data),
    ),
    emailVerification: {
      sendVerificationEmail: (data) => sendVerificationEmail(mailer, data),
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
    },
    rateLimit: {
      enabled: true,
    },
    plugins: createProjectAuthPlugins(),
  });

  return auth;
}
