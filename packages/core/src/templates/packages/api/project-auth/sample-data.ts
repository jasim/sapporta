/**
 * The sample-data account, and the permission that lets it exist.
 *
 * `pnpm seed` has to write rows as somebody, and on a database nobody has
 * signed in to yet the only account it can have is one it creates itself, with
 * a password written in `packages/api/seed.ts`. Creating that account skips
 * everything the sign-up route does to protect a real address: the rate limit,
 * the trusted-origin check, and the verification email.
 *
 * So both functions here check the permission themselves, rather than trusting
 * the script that calls them. The check holds for every caller and not only
 * for the one this was written for - a route that reached either of these is
 * refused on any machine that has not granted the permission, which is every
 * machine except a developer's.
 */
import { eq } from "drizzle-orm";
import type { ProjectDbConnection } from "@sapporta/server";
import { deviceTimeZone, type TimeZone } from "@sapporta/shared/temporal";
import { user } from "./schema.js";

/** The account `pnpm seed` writes its rows as, as named in `seed.ts`. */
export interface SampleDataAccount {
  name: string;
  email: string;
  password: string;
}

/**
 * The time zone the seeded workspace starts on: this machine's.
 *
 * A sign-up from a browser carries the person's zone; a seed run has no
 * request to carry one, so it uses the machine's. Seeded timestamps and
 * day-grouped reports then read on the clock of whoever is about to look at
 * them. It is an ordinary workspace zone afterwards, changed on the workspace
 * settings screen.
 */
export function sampleDataTimeZone(): TimeZone {
  return deviceTimeZone();
}

/**
 * Refuses unless this project has granted sample-data seeding.
 *
 * The permission has to be granted rather than merely not withheld:
 * `SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING` ships in `.env.development` and in no
 * other environment file, so an environment that never heard of it is refused
 * instead of being taken for a developer's machine. `NODE_ENV` alone would not
 * do, because it is unset by default and a staging box, a systemd unit, and a
 * CI run against a restored snapshot all look exactly like a laptop.
 */
export function assertSampleDataSeedingAllowed(): void {
  if (
    process.env.SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return;
  }
  throw new Error(
    "Sample data creates an account whose password is written in packages/api/seed.ts, so it runs only where SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING=true and NODE_ENV is not production. Add SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING=true to .env.development to seed this project, and never to a deployment.",
  );
}

/**
 * Records that the sample-data account needs no verification link.
 *
 * Nobody can click a verification link for an address that belongs to whoever
 * ran `pnpm seed`, so the account is vouched for here instead. Skipping
 * verification for an address a person actually gave you is a different thing
 * entirely, and not something a route should do: resend the verification email
 * instead.
 */
export function markSampleDataAccountVerified(
  conn: ProjectDbConnection,
  userId: string,
): void {
  assertSampleDataSeedingAllowed();
  conn.db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.id, userId))
    .run();
}
