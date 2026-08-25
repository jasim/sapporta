/**
 * Opens the application for `pnpm seed`, with no server running.
 *
 * This is `openScriptRuntime()` with the sample-data account wired in: the
 * account named in `seed.ts` is created on the first run and signed in to on
 * every run after, and the rows written through it go down the app's own save
 * path - the same validation, column defaults, and row ownership a request
 * from the browser gets.
 *
 * Creating that account is the part that needs guarding, and it guards itself,
 * in `project-auth/sample-data.ts`. The check below is the same one, so that
 * `pnpm seed` refuses on a machine that has not granted the permission even on
 * a second run, where the account already exists and nothing would be created.
 *
 * A script of your own belongs on `script-runtime.ts` instead. It signs in
 * with a password you supply and creates nothing.
 */
import {
  assertSampleDataSeedingAllowed,
  type SampleDataAccount,
} from "./project-auth/sample-data.js";
import { openScriptRuntime, type ScriptRuntime } from "./script-runtime.js";

export type { SampleDataAccount } from "./project-auth/sample-data.js";

/**
 * What `seed.ts` gets back: the workspace, `rows()`, `db`, `auth`, and
 * `close()`.
 */
export type SeedRuntime = ScriptRuntime;

/**
 * Opens the application and signs in as the sample-data account.
 *
 * Apply migrations first, so the tables being seeded exist. Mail is off: the
 * addresses in a database belong to people who did not ask a seed run to write
 * to them.
 */
export async function openSeedRuntime(
  account: SampleDataAccount,
): Promise<SeedRuntime> {
  assertSampleDataSeedingAllowed();
  return openScriptRuntime(account, {
    credentialsSource: "packages/api/seed.ts",
    createMissingAccount: (auth) => auth.createSampleDataAccount(account),
  });
}
