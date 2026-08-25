/**
 * Sample data for development.
 *
 *   pnpm seed
 *
 * Write rows below by importing a table from `./schema/` and calling
 * `demo.rows(table).create(...)`, creating parent rows before the rows that
 * reference them. Rows go through the same validation, defaults, and row
 * ownership as a request from the browser, so seeded data is data the app can
 * actually produce. `workspace_id` and `scoped_to_user_id` are stamped from
 * the account below and must not be set here.
 *
 * No server has to be running. The account is created on the first run and
 * signed in to afterwards; sign in as it to see the data in the browser. Guard
 * your own writes the way the example below does, so a second `pnpm seed` does
 * not add the same rows again.
 *
 * The seeded workspace takes its time zone from this machine, so seeded
 * timestamps and day-grouped reports read on your own clock. Change it later
 * on the workspace settings screen.
 *
 * To seed through a domain workflow instead of `rows()`, hand it `demo.db` and
 * `demo.auth`. They are the same pair a route gives it.
 *
 * For a script that is not sample data - a nightly job, a one-off import - use
 * `openScriptRuntime()` from `./script-runtime.js` and give it the address and
 * password of a real account.
 */
import { openSeedRuntime } from "./seed-runtime.js";

const SAMPLE_DATA_ACCOUNT = {
  name: "Demo User",
  email: "demo@example.com",
  password: "demo-password",
};

const demo = await openSeedRuntime(SAMPLE_DATA_ACCOUNT);

// Write sample rows here. For a `packages/api/schema/books.ts` exporting `books`:
//
//   import { books } from "./schema/books.js";
//
//   if ((await demo.rows(books).count()) === 0) {
//     const dune = await demo.rows(books).create({
//       title: "Dune",
//       author: "Frank Herbert",
//       published_on: "1965-08-01",
//     });
//
//     // `create` returns the stored row, so use its id for what references it:
//     await demo.rows(reviews).create({ book_id: dune.id, rating: 5 });
//   }

console.log(`Seeding into ${demo.workspace.name}.`);
console.log("No rows written yet - add them in packages/api/seed.ts.");
console.log(
  `Sign in as ${SAMPLE_DATA_ACCOUNT.email}, with the password written above.`,
);
demo.close();
