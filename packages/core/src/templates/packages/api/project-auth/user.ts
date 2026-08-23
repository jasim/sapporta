/**
 * Reads of the stored account table.
 *
 * A browser session, an agent access token, and a command-line script each
 * identify a person a different way, but all three then need the same four
 * facts about them, from the same row. Reaching that row happens here, so the
 * three paths cannot disagree about what an account is.
 *
 * Writes to this table belong to whoever owns the change: Better Auth owns
 * sign-up and password changes, and `sample-data.ts` owns the one write
 * `pnpm seed` needs.
 */
import { eq, type InferSelectModel } from "drizzle-orm";
import type { ProjectDbConnection, SapportaAuthUser } from "@sapporta/server";
import { user } from "./schema.js";

/** The columns auth relies on. The rest of the row is Better Auth's business. */
const authUserColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
};

export function findUserById(
  conn: ProjectDbConnection,
  id: string,
): SapportaAuthUser | null {
  return authUser(
    conn.db.select(authUserColumns).from(user).where(eq(user.id, id)).get(),
  );
}

export function findUserByEmail(
  conn: ProjectDbConnection,
  email: string,
): SapportaAuthUser | null {
  return authUser(
    conn.db
      .select(authUserColumns)
      .from(user)
      .where(eq(user.email, email))
      .get(),
  );
}

type AuthUserRow = Pick<
  InferSelectModel<typeof user>,
  "id" | "name" | "email" | "emailVerified"
>;

function authUser(row: AuthUserRow | undefined): SapportaAuthUser | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name ?? null,
    email: row.email,
    emailVerified: row.emailVerified,
  };
}
