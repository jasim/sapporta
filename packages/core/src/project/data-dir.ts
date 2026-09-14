/**
 * The data directory of a Sapporta app.
 *
 * The data directory holds the SQLite database (`sqlite.db`) and any other
 * files that belong to one installation of the app. For example, one directory
 * can hold sample data and another can hold real data, and the same project
 * can run against either one.
 *
 * The directory is always named by the `SAPPORTA_DATA_DIR` environment
 * variable, and there is no default. Due to this, a process that did not
 * receive the variable stops with an error instead of opening some other
 * database. For example, if `pnpm dev` runs on sample data, `pnpm db:migrate`
 * cannot quietly migrate a different database.
 *
 * This module and `project-paths.ts`, the only module it imports, use nothing
 * but Node built-ins, because `drizzle.config.ts` imports it through
 * `@sapporta/server/data-dir` every time Drizzle Kit runs.
 */

import { isAbsolute, join, resolve } from "node:path";
import { projectRoot } from "./project-paths.js";

const DATA_DIR_ENV_VAR = "SAPPORTA_DATA_DIR";

/**
 * Join path segments onto the data directory:
 * `dataPath("user-config", "import-presets.json")`.
 *
 * `SAPPORTA_DATA_DIR` may be an absolute path, or a path relative to the
 * project root (the directory with `sapporta.json`). For example, `data`
 * means `data/` inside the project. A relative path is not resolved against
 * the working directory, because `pnpm dev`, Drizzle Kit, and a container
 * each start in a different one.
 *
 * Throws when `SAPPORTA_DATA_DIR` is unset or empty.
 */
export function dataPath(...segments: string[]): string {
  const dir = process.env[DATA_DIR_ENV_VAR];
  if (!dir) {
    throw new Error(
      `${DATA_DIR_ENV_VAR} is not set. Set it in the environment to the directory that holds this app's sqlite.db: an absolute path, or a path relative to the project root.`,
    );
  }
  const base = isAbsolute(dir) ? dir : resolve(projectRoot(), dir);
  return join(base, ...segments);
}

/** The path of the app's SQLite database inside the data directory. */
export function databasePath(): string {
  return dataPath("sqlite.db");
}
