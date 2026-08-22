import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { findProjectRootFrom } from "../project/project-paths.js";

const DEV_ENV_FILE = ".env.development";
const MAX_PORT = 65535;

/**
 * The API URL of the project the CLI is running inside, if there is one.
 *
 * API-backed commands are clients of a running app. A project already records
 * the port its API binds, in `SAPPORTA_API_PORT` in its `.env.development`, so
 * the CLI reads that rather than assuming the framework's default port. A
 * project whose ports were moved off the defaults stays reachable without
 * `--api-url` on every command.
 *
 * `SAPPORTA_PUBLIC_APP_URL` is deliberately not consulted. That setting is the
 * origin a browser loads the app from, which in a deployment is a public
 * domain reached through a reverse proxy; it says nothing about where the API
 * process listens on this machine.
 *
 * Returns `undefined` outside a project, when the file is absent, and when the
 * port it records is unusable. Each of those leaves the built-in default in
 * place instead of failing a command over a convenience lookup.
 */
export function readProjectApiUrl(
  cwd: string = process.cwd(),
): string | undefined {
  const projectRoot = findProjectRootFrom(cwd);
  if (projectRoot === null) return undefined;

  const port = readApiPort(join(projectRoot, DEV_ENV_FILE));
  if (port === undefined) return undefined;

  return `http://localhost:${port}`;
}

function readApiPort(envFile: string): number | undefined {
  let contents: string;
  try {
    contents = readFileSync(envFile, "utf-8");
  } catch {
    return undefined;
  }

  const value = parseEnv(contents).SAPPORTA_API_PORT;
  if (value === undefined || value === "") return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) return undefined;
  return port;
}
