import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { ProjectDbConnection } from "@sapporta/server";
import {
  betterAuth,
  type BetterAuthOptions,
  type DBAdapter,
  type DBTransactionAdapter,
} from "better-auth";
import type { SapportaMailer } from "../mailer.js";
import type { ProjectAuthEnv } from "./env.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./emails.js";
import {
  createProjectAuthEmailAndPasswordOptions,
  createProjectAuthPlugins,
  projectAuthBasePath,
  projectAuthCookiePrefix,
  projectAuthDrizzleAdapterConfig,
} from "./options.js";
import * as authSchema from "./schema.js";

/**
 * Configures sign-in, sessions, and account emails. Application permissions
 * and row access are defined separately in `authz/`.
 */
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

/**
 * Opens the project database for Better Auth, one sign-up or sign-in at a time.
 *
 * Signing up writes the person's user row and their password credential as two
 * separate statements. A failure between the two would otherwise leave an email
 * address that can neither sign in, because it has no password to check, nor
 * sign up again, because the address is taken. Grouping the writes means a
 * failed sign-up leaves nothing behind and the next attempt starts clean.
 *
 * The Drizzle adapter's own `transaction: true` cannot do this here. It hands
 * an async function to better-sqlite3, whose transactions are synchronous and
 * reject it outright.
 */
function createProjectAuthDatabase(
  conn: ProjectDbConnection,
): (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  const openAdapter = drizzleAdapter(conn.db, {
    schema: authSchema,
    ...projectAuthDrizzleAdapterConfig,
  });

  return (options) => {
    const adapter = openAdapter(options);
    return {
      ...adapter,
      transaction: async <R>(
        write: (trx: DBTransactionAdapter<BetterAuthOptions>) => Promise<R>,
      ): Promise<R> => {
        if (conn.sqlite.inTransaction) return write(adapter);
        conn.sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await write(adapter);
          conn.sqlite.exec("COMMIT");
          return result;
        } catch (err) {
          conn.sqlite.exec("ROLLBACK");
          throw err;
        }
      },
    };
  };
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
    advanced: {
      cookiePrefix: projectAuthCookiePrefix,
      // Account emails are sent after the sign-up they belong to has been
      // written, so the request does not wait on the mail server and the
      // sign-up transaction is not held open for the length of a send.
      backgroundTasks: {
        handler: (task) => {
          void task;
        },
      },
    },
    database: createProjectAuthDatabase(conn),
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
