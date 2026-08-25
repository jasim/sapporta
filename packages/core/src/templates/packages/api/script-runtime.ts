/**
 * Opens the application for a command-line script, with no server running.
 *
 * A script that reads or writes rows needs what a request handler is handed:
 * the application itself, an account to act as, and that account's row access.
 * This assembles all three from an email and a password, so `pnpm seed`, a
 * nightly job, and a one-off import share one way in instead of each inventing
 * its own. None of the HTTP plumbing is needed - a script runs on the same
 * machine as the database.
 *
 * It hands back what a handler works with: `rows()` for one table, and `db`
 * and `auth` for a domain workflow, which takes the same pair a route gives
 * it. A script therefore runs the app's own logic, not a copy of it.
 *
 * The account is proved, not named. Signing in here means holding the
 * password, exactly as it does in a browser, so there is no way to act as an
 * address whose password the caller does not have. That is what makes this
 * file safe to import from any script.
 *
 * It is still not for a route. A request handler already carries the row
 * access it earned, at `c.get("auth")`, and a route that asks for a password
 * is a route that can be asked to check passwords - see
 * `verifyEmailPasswordWithoutRateLimit()` in `project-auth/better-auth.ts`.
 */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import {
  createAuthContext,
  requestDataAuthority,
  scopedRows,
  systemGlobalOnlyAuthority,
  userPrincipal,
  workspaceGlobalOnlyAuthority,
  workspaceUserScopedAuthority,
  type AuthWorkspace,
  type SapportaAuthContext,
  type SapportaAuthUser,
  type ScopedRows,
  type TableDef,
} from "@sapporta/server";
import { buildAbility } from "./authz/ability.js";
import type { AppAbility, AppWorkspaceMembership } from "./authz/types.js";
import {
  ensureWorkspaceMembership,
  membershipFromRow,
  type ProjectBetterAuth,
} from "./project-auth/index.js";
import { openProjectRuntime } from "./runtime.js";

/** The account a script signs in as. */
export interface ScriptCredentials {
  email: string;
  password: string;
}

export interface OpenScriptRuntimeOptions {
  /**
   * Whether outgoing mail is delivered. Off by default, because the addresses
   * in a database belong to people who did not ask a script to write to them.
   */
  sendMail?: boolean;
  /**
   * Where the credentials came from, named in the error when they do not match
   * an account. `pnpm seed` passes `packages/api/seed.ts`.
   */
  credentialsSource?: string;
  /**
   * Creates the account when no account holds this address yet.
   *
   * A script that has to run against a database nobody has signed in to needs
   * some way to bring its account into being; `pnpm seed` passes the one that
   * creates the sample-data account. Leave this out and a script signs in or
   * stops, which is what an ordinary script should do.
   */
  createMissingAccount?: (
    auth: ProjectBetterAuth,
  ) => Promise<SapportaAuthUser>;
}

export interface ScriptRuntime {
  /** The workspace this script's rows land in. Sign in to see them there. */
  workspace: AuthWorkspace;
  /** Reads and writes one table as the signed-in account, through the app's rules. */
  rows: <TTable extends AnySQLiteTable>(
    table: TableDef<TTable>,
  ) => ScopedRows<TTable>;
  /** The database, for a domain workflow that opens its own transaction. */
  db: BetterSQLite3Database;
  /**
   * This script's row access, in the form a domain workflow expects.
   *
   * A workflow takes `{ db, auth }`; a route gives it `c.get("db")` and
   * `c.get("auth")`, and a script gives it these. Call the workflow rather
   * than repeating what it writes against `rows()`.
   */
  auth: SapportaAuthContext<AppAbility, AppWorkspaceMembership>;
  /** Closes the database. Call this when the script is done. */
  close: () => void;
}

/**
 * Opens the application and signs in as the account these credentials name.
 *
 * The database, table definitions, and auth come up exactly as they do for the
 * server, so a script sees the schema checks the server would have refused to
 * start without. Apply migrations first.
 */
export async function openScriptRuntime(
  credentials: ScriptCredentials,
  options: OpenScriptRuntimeOptions = {},
): Promise<ScriptRuntime> {
  const { conn, sapporta, projectAuth, close } = await openProjectRuntime({
    sendMail: options.sendMail ?? false,
  });

  try {
    const user = await signInFromScript(projectAuth.auth, credentials, options);
    const membership = membershipFromRow(ensureWorkspaceMembership(conn, user));
    const principal = userPrincipal({ user, membership });
    // A script works on the whole workspace it signed in to, so this takes all
    // three authorities. It is a fixed set, not a policy anyone chooses at the
    // call site: a served request's row access is still decided only by
    // `authz/resolveRequestDataAuthority()`.
    const dataAuthority = requestDataAuthority({
      systemGlobalOnly: systemGlobalOnlyAuthority(),
      workspaceGlobalOnly: workspaceGlobalOnlyAuthority(membership.workspace),
      workspaceUserScoped: workspaceUserScopedAuthority({
        workspace: membership.workspace,
        user,
      }),
    });
    const auth = createAuthContext({
      principal,
      dataAuthority,
      ability: buildAbility({ principal, dataAuthority }),
      catalog: sapporta.catalog,
    });
    return {
      workspace: membership.workspace,
      rows: (table) => scopedRows(conn.db, auth, table),
      db: conn.db,
      auth,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}

/**
 * Returns the account these credentials belong to.
 *
 * Signing in has to prove the password, and creating cannot reach an account
 * that already exists, so neither branch can act as a person whose credentials
 * the script does not hold. A wrong password stops the script, which is what
 * should happen when the address turns out to belong to someone real on this
 * database.
 */
async function signInFromScript(
  auth: ProjectBetterAuth,
  credentials: ScriptCredentials,
  options: OpenScriptRuntimeOptions,
): Promise<SapportaAuthUser> {
  const signedIn = await auth.verifyEmailPasswordWithoutRateLimit(credentials);
  if (signedIn) return signedIn;

  const source = options.credentialsSource
    ? ` Change the address in ${options.credentialsSource}.`
    : "";
  if (!options.createMissingAccount) {
    throw new Error(
      `Could not sign in as ${credentials.email}. No account holds that address with that password.${source}`,
    );
  }
  try {
    return await options.createMissingAccount(auth);
  } catch (error) {
    throw new Error(
      `Could not sign in as ${credentials.email}, and could not create it either. An account with that address already exists with a different password.${source}`,
      { cause: error },
    );
  }
}
