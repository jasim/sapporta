import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { ProjectDbConnection, SapportaAuthUser } from "@sapporta/server";
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
  projectAuthUserOptions,
} from "./options.js";
import {
  assertSampleDataSeedingAllowed,
  markSampleDataAccountVerified,
  sampleDataTimeZone,
  type SampleDataAccount,
} from "./sample-data.js";
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
  /** Answers the sign-in, sign-up, and session routes mounted under `/api/auth`. */
  handler: (request: Request) => Promise<Response>;
  api: BetterAuthSessionApi;
  /**
   * Registers the sample-data account `pnpm seed` uses, and vouches for its
   * address.
   *
   * Refused unless this project has granted sample-data seeding; the check is
   * in `sample-data.ts` and runs here, not in whatever called this. Real
   * sign-ups go through the sign-up route, which is where rate limiting,
   * trusted origins, and the verification email apply, and none of them apply
   * here. The password is hashed and stored by the same code that serves that
   * route, so the account is one a person can sign in with in a browser.
   * Throws if the address is already taken.
   */
  createSampleDataAccount: (
    account: SampleDataAccount,
  ) => Promise<SapportaAuthUser>;
  /**
   * Returns the account this password belongs to, or null when it does not.
   *
   * This is the password check the sign-in route performs, without the HTTP
   * request around it, so a caller with no request still has to prove an
   * address rather than assert it. What the request carried is gone with it:
   * the rate limit in front of the sign-in route counts requests, so nothing
   * throttles this one. Call it from a command-line script, where there is no
   * caller to throttle and the password came from the person running the
   * script - `script-runtime.ts` is the one caller here.
   *
   * Never call it from a route. A request handler already carries the row
   * access it earned, at `c.get("auth")`, and a route that checks passwords is
   * a route that can be asked to check passwords.
   *
   * A session row is written as a side effect of the check and is never read.
   */
  verifyEmailPasswordWithoutRateLimit: (credentials: {
    email: string;
    password: string;
  }) => Promise<SapportaAuthUser | null>;
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
  const auth = betterAuth({
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
    user: projectAuthUserOptions,
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

  return {
    handler: (request) => auth.handler(request),
    api: auth.api,
    createSampleDataAccount: async (account) => {
      assertSampleDataSeedingAllowed();
      const { user } = await auth.api.signUpEmail({
        body: { ...account, timeZone: sampleDataTimeZone() },
      });
      markSampleDataAccountVerified(conn, user.id);
      return {
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        emailVerified: true,
      };
    },
    verifyEmailPasswordWithoutRateLimit: async (credentials) => {
      try {
        const { user } = await auth.api.signInEmail({ body: credentials });
        return {
          id: user.id,
          name: user.name ?? null,
          email: user.email,
          emailVerified: user.emailVerified,
        };
      } catch {
        // Better Auth answers a wrong password with a thrown API error. A
        // caller only needs to know the password did not match.
        return null;
      }
    },
  };
}
