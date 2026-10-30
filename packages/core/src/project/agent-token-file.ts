import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { ErrorCode, OperationError } from "../errors.js";

/**
 * The project's agent token file: a dotenv file in the project root holding
 * `SAPPORTA_API_TOKEN` for the coding agents that work in the folder.
 *
 * It is kept out of `.env.development`. `pnpm dev` starts the API with
 * `--env-file=.env.development` only, so the API process's environment never
 * holds an agent's credential; an app's server code may still mint the token
 * and write this file. A project gitignores it and keeps it out of its Docker
 * build context. Where the CLI ranks it among its token sources is decided in
 * `resolveCliRuntimeConfig`.
 */
export const PROJECT_API_TOKEN_FILE = ".env.agent";

const TOKEN_KEY = "SAPPORTA_API_TOKEN";

/**
 * The token the project at `root` keeps for its agents, or undefined when the
 * file is absent or its token is missing or blank. Nothing else is read from
 * the file. A file that exists but cannot be read is an error, because a
 * credential that is silently skipped would show up only as a refused request.
 */
export function readProjectApiToken(root: string): string | undefined {
  const path = join(root, PROJECT_API_TOKEN_FILE);
  let contents: string;
  try {
    contents = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new OperationError(
      `Cannot read the agent token file ${path}: ${(err as Error).message}`,
      ErrorCode.VALIDATION_FAILED,
    );
  }
  return tokenFromContents(contents);
}

/**
 * Writes `token` as the project's agent token, replacing the file. `comment`
 * is written above it, one `# ` line each, to say where the file came from.
 *
 * The file is a credential. It is written to a new owner-only file beside it
 * and renamed into place, so it is never readable by others, a reader never
 * sees it half-written, and a symlink at its path is replaced rather than
 * written through.
 *
 * Throws when a comment spans lines, or when the file would not read back as
 * `token` (a blank token, or one the dotenv format would cut or unquote).
 */
export function writeProjectApiToken(
  root: string,
  token: string,
  comment: readonly string[] = [],
): void {
  if (comment.some((line) => /[\r\n]/.test(line))) {
    throw new Error("An agent token file comment must be a single line");
  }
  const contents = [
    ...comment.map((line) => `# ${line}`),
    ...(comment.length > 0 ? [""] : []),
    `${TOKEN_KEY}=${token}`,
    "",
  ].join("\n");
  if (tokenFromContents(contents) !== token) {
    throw new Error(
      `${PROJECT_API_TOKEN_FILE} cannot hold this token: it would read back differently`,
    );
  }

  const path = join(root, PROJECT_API_TOKEN_FILE);
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, contents, { mode: 0o600, flag: "wx" });
  renameSync(tempPath, path);
}

function tokenFromContents(contents: string): string | undefined {
  const token = parseEnv(contents)[TOKEN_KEY];
  return token === undefined || token === "" ? undefined : token;
}
