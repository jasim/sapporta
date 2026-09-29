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
 * `pnpm dev` starts the API with `node --env-file=.env.development`, where a
 * variable already set in the environment takes precedence over the file. The
 * port is read the same way, so a `SAPPORTA_API_PORT` exported in the shell
 * sends the CLI to the port the server binds in that shell.
 *
 * `PORT` is deliberately not consulted, although the server falls back to it.
 * It is a hosting-platform setting that unrelated tools also export, and in
 * development the server refuses to start when it disagrees with
 * `SAPPORTA_API_PORT`.
 *
 * `SAPPORTA_PUBLIC_APP_URL` is deliberately not consulted either. That setting
 * is the origin a browser loads the app from, which in a deployment is a
 * public domain reached through a reverse proxy; it says nothing about where
 * the API process listens on this machine.
 *
 * Returns `undefined` outside a project, when neither the environment nor the
 * file sets the port, and when the port is unusable. Each of those leaves the
 * built-in default in place instead of failing a command over a convenience
 * lookup.
 */
export function readProjectApiUrl(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const projectRoot = findProjectRootFrom(cwd);
  if (projectRoot === null) return undefined;

  const devEnv = { ...readEnvFile(join(projectRoot, DEV_ENV_FILE)), ...env };
  const port = parsePort(devEnv.SAPPORTA_API_PORT);
  if (port === undefined) return undefined;

  return `http://localhost:${port}`;
}

function readEnvFile(envFile: string): Record<string, string | undefined> {
  let contents: string;
  try {
    contents = readFileSync(envFile, "utf-8");
  } catch {
    return {};
  }
  return parseEnv(contents);
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) return undefined;
  return port;
}
