/**
 * The application runtime, without any HTTP server around it.
 *
 * Opening the database, loading the table schema, and configuring auth and
 * mail are the same steps whether the app is about to serve requests or a
 * command-line script is about to read or write rows. `boot.ts` calls
 * `openProjectRuntime()` and then mounts Hono on top of it, so a script that
 * starts from here behaves the way the running app does.
 */
import {
  connectProject,
  findProjectRootFrom,
  fromProjectRoot,
  loadSapportaProject,
  setProjectRoot,
  type ProjectDbConnection,
  type SapportaProject,
} from "@sapporta/server";
import { buildAbility } from "./authz/ability.js";
import { resolveRequestDataAuthority } from "./authz/request-data-authority.js";
import { createSapportaMailer, type SapportaMailer } from "./mailer.js";
import {
  createProjectAuth,
  readProjectAuthEnv,
  type ProjectAuth,
  type ProjectAuthEnv,
  type PublicRoutePattern,
} from "./project-auth/index.js";

export interface OpenProjectRuntimeOptions {
  /**
   * Whether outgoing mail is delivered. Defaults to true, which honours
   * `SAPPORTA_MAIL_TRANSPORT`.
   *
   * `script-runtime.ts` turns it off, because the addresses in a database
   * belong to people who did not ask a command-line script to write to them.
   */
  sendMail?: boolean;
  /**
   * Routes an anonymous caller may reach, from `app.ts`.
   *
   * Only the HTTP server has anonymous callers, so `boot.ts` passes this and
   * nothing else does. It stays an option rather than an import here so that
   * opening the app does not pull in every route module.
   */
  publicRoutes?: readonly PublicRoutePattern[];
}

export interface ProjectRuntime {
  projectRoot: string;
  frontendDistDir: string;
  conn: ProjectDbConnection;
  sapporta: SapportaProject;
  env: ProjectAuthEnv;
  mailer: SapportaMailer;
  projectAuth: ProjectAuth;
  /** Closes the database. The HTTP server holds it open for its lifetime. */
  close: () => void;
}

/**
 * Assembles the runtime and returns its parts.
 *
 * The project root is found by walking up from this file, so the app starts
 * the same way from any working directory - `pnpm dev`, `pnpm start`, Docker,
 * or systemd.
 */
export async function openProjectRuntime(
  options: OpenProjectRuntimeOptions = {},
): Promise<ProjectRuntime> {
  const projectRoot = findProjectRootFrom(import.meta.dirname);
  if (!projectRoot) {
    throw new Error(
      `Could not find sapporta.json walking up from ${import.meta.dirname}`,
    );
  }
  setProjectRoot(projectRoot);
  const { apiDistDir, frontendDistDir, databasePath } =
    fromProjectRoot(projectRoot);
  const conn = connectProject(databasePath);

  // Load the compiled table definitions and check the schema's structural and
  // row-access rules. Database migrations remain a separate step.
  const sapporta = await loadSapportaProject({
    name: "%%SAPPORTA:NAME%%",
    slug: "%%SAPPORTA:SLUG%%",
    projectRoot,
    apiDistDir,
    conn,
  });

  const env = readProjectAuthEnv();
  const mailer = createSapportaMailer(
    options.sendMail === false
      ? { from: env.mail.from, transport: "disabled" }
      : env.mail,
  );

  // The application defines both allowed actions and accessible rows.
  const projectAuth = createProjectAuth({
    conn,
    env,
    catalog: sapporta.catalog,
    mailer,
    buildAbility,
    resolveRequestDataAuthority,
    publicRoutes: options.publicRoutes,
  });

  return {
    projectRoot,
    frontendDistDir,
    conn,
    sapporta,
    env,
    mailer,
    projectAuth,
    close: () => conn.sqlite.close(),
  };
}
