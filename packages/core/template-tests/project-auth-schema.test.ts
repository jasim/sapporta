import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { connectProject, type ProjectDbConnection } from "@sapporta/server";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { getAuthTables } from "better-auth/db";
import type { BetterAuthOptions } from "better-auth";
import {
  declaredPackageSpec,
  readPackageJson,
  resolveInstalledPackage,
} from "../src/cli/init-project/package-metadata.js";
import { createSapportaMailer } from "../src/templates/packages/api/mailer.js";
import { createBetterAuth } from "../src/templates/packages/api/project-auth/better-auth.js";
import { readProjectAuthEnv } from "../src/templates/packages/api/project-auth/env.js";
import {
  createProjectAuthEmailAndPasswordOptions,
  createProjectAuthPlugins,
} from "../src/templates/packages/api/project-auth/options.js";
import * as authTokensSchema from "../src/templates/packages/api/project-auth/auth-tokens-schema.js";
import * as authSchema from "../src/templates/packages/api/project-auth/schema.js";

/**
 * `schema.ts` is generated from the auth setup in `options.ts` by the Better
 * Auth CLI, and a project's migrations are generated from that file in turn.
 * These tests hold the checked in schema to the tables and columns the
 * installed Better Auth version reads and writes, so a schema that no longer
 * matches fails here rather than as a failed sign-up in a generated project.
 *
 * Regenerate the schema with:
 *   pnpm zx scripts/generate-project-auth-schema.mjs
 */

const authOptions = {
  emailAndPassword: createProjectAuthEmailAndPasswordOptions(
    false,
    async () => {},
  ),
  plugins: createProjectAuthPlugins(),
} satisfies BetterAuthOptions;

const expectedTables = getAuthTables(authOptions);
type ExpectedTable = (typeof expectedTables)[string];

const generatedColumns = readGeneratedColumns();

describe("project auth schema", () => {
  let conn: ProjectDbConnection | null = null;

  afterEach(() => {
    conn?.sqlite.close();
    conn = null;
  });

  /**
   * Better Auth adds columns in minor releases, so a caret range would let a
   * generated project install a minor this schema was not generated for. A
   * tilde range holds the project to the minor line the checked in schema
   * covers; changing the minor is then a deliberate change that regenerates
   * the schema with it.
   */
  it("gives generated projects the Better Auth minor line this schema covers", () => {
    const corePackageJsonPath = fileURLToPath(
      new URL("../package.json", import.meta.url),
    );
    const scaffoldSpec = declaredPackageSpec(
      readPackageJson(corePackageJsonPath),
      "better-auth",
    );
    const installed = resolveInstalledPackage(
      corePackageJsonPath,
      "better-auth",
    ).packageJson.version;

    expect(scaffoldSpec).toMatch(/^~\d+\.\d+\.\d+$/);
    expect(minorLine(scaffoldSpec.slice(1))).toBe(minorLine(installed ?? ""));
  });

  /**
   * Sign-up reaches the user, account, and session tables only. This covers
   * the rest, naming the missing table or column instead of leaving it to
   * surface as a failure in whichever flow first reads it.
   */
  it("declares every table and column Better Auth reads and writes", () => {
    const missing = Object.values(expectedTables).flatMap((table) => {
      const columns = generatedColumns.get(table.modelName);
      if (columns === undefined) return [table.modelName];
      return expectedColumnNames(table)
        .filter((column) => !columns.has(column))
        .map((column) => `${table.modelName}.${column}`);
    });

    expect(missing).toEqual([]);
  });

  it("accepts an email sign-up and sign-in against the generated tables", async () => {
    conn = await connectAuthDb();
    const auth = createProjectAuth(conn);
    const credentials = {
      name: "Ada Lovelace",
      email: "ada@example.test",
      password: "correct-horse-battery-staple",
    };

    const signUp = await auth.handler(
      authRequest("/api/auth/sign-up/email", credentials),
    );
    expect(await readAuthError(signUp)).toBeNull();
    expect(signUp.status).toBe(200);

    const signIn = await auth.handler(
      authRequest("/api/auth/sign-in/email", {
        email: credentials.email,
        password: credentials.password,
      }),
    );
    expect(await readAuthError(signIn)).toBeNull();
    expect(signIn.status).toBe(200);
  });
});

function minorLine(version: string): string {
  const [major, minor] = version.split(".");
  return `${major}.${minor}`;
}

/**
 * The SQL column a Better Auth field maps to. A field carries an explicit
 * `fieldName` only when it renames the column; otherwise the field name is the
 * column name, which is how the Drizzle adapter resolves it too.
 */
function expectedColumnNames(table: ExpectedTable): string[] {
  return Object.entries(table.fields).map(
    ([name, field]) => field.fieldName ?? name,
  );
}

/**
 * Reads the checked in Drizzle tables as SQL column names, keyed by SQL table
 * name — the names Better Auth resolves a model and field to through the
 * Drizzle adapter.
 */
function readGeneratedColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const exported of Object.values(authSchema)) {
    if (!is(exported, Table)) continue;
    const columns = Object.values(getTableColumns(exported)).map(
      (column) => column.name,
    );
    tables.set(getTableName(exported), new Set(columns));
  }
  return tables;
}

/**
 * Creates the auth tables in an in-memory database from the checked in schema
 * files, the same way a generated project creates them through
 * `drizzle-kit generate` and `drizzle-kit migrate`.
 */
async function connectAuthDb(): Promise<ProjectDbConnection> {
  const empty = await generateSQLiteDrizzleJson({});
  const generated = await generateSQLiteDrizzleJson({
    ...authSchema,
    ...authTokensSchema,
  });
  const statements = await generateSQLiteMigration(empty, generated);
  const conn = connectProject(":memory:");
  for (const statement of statements) {
    conn.sqlite.exec(statement);
  }
  return conn;
}

function createProjectAuth(conn: ProjectDbConnection) {
  const env = readProjectAuthEnv({
    BETTER_AUTH_SECRET: "test-secret-value-for-project-auth-schema",
    SAPPORTA_PUBLIC_APP_URL: "http://localhost:5173",
    SAPPORTA_REQUIRE_VERIFIED_EMAIL: "false",
    SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
    SAPPORTA_MAIL_TRANSPORT: "disabled",
  });
  return createBetterAuth({
    conn,
    env,
    mailer: createSapportaMailer(env.mail),
  });
}

function authRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost:5173${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5173",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Better Auth answers a rejected request with a JSON error body. Reading it
 * before asserting on the status reports the reason, such as a column missing
 * from the Drizzle schema, instead of only the status code.
 */
async function readAuthError(response: Response): Promise<string | null> {
  if (response.ok) return null;
  return `${response.status} ${await response.clone().text()}`;
}
