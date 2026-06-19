import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { init } from "./init.js";
import { describeAll, describeOne } from "./describe.js";
import { ROUTES, registerRoutes } from "./routes.js";
import { httpRequest } from "./http-client.js";
import { OperationError, ErrorCode } from "../introspect/types.js";
import { buildRequest, renderResult } from "./request.js";
import {
  parseFlags,
  emitResult,
  resolveOutputFormat,
  type OutputFormat,
} from "./format.js";
import { resolveCliCredentials } from "./credentials.js";

// Re-export for programmatic access
export { ROUTES } from "./routes.js";
export type { CliRoute } from "./routes.js";
export { buildRequest, renderResult } from "./request.js";
export type { RequestSpec } from "./request.js";

function readCliPackageVersion(): string {
  const packageJsonPath = resolve(
    import.meta.dirname,
    "..",
    "templates",
    "dependency-package-snapshots",
    "cli",
    "package.json",
  );
  const parsedPackageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf-8"),
  ) as unknown;

  if (typeof parsedPackageJson !== "object" || parsedPackageJson === null) {
    throw new Error(`${packageJsonPath} must contain a JSON object.`);
  }

  const packageJson = parsedPackageJson as Record<string, unknown>;
  if (packageJson.name !== "sapporta") {
    throw new Error(
      `Expected vendored sapporta package metadata, got ${String(packageJson.name)}.`,
    );
  }
  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error(`${packageJsonPath} is missing a package version.`);
  }

  return packageJson.version;
}

/**
 * Emit an error and exit. In table mode, prints to stderr like before.
 * In JSON mode, emits a structured error envelope to stdout.
 */
function handleError(err: any, format: OutputFormat): never {
  const code = err instanceof OperationError ? err.code : ErrorCode.INTERNAL;
  const result = { ok: false as const, error: err.message, code };
  emitResult(result, format);
  process.exit(err instanceof OperationError ? 1 : 2);
}

// ---------------------------------------------------------------------------
// API command runner: resolve credentials, build the request, and render the
// server response in the requested output format.
// ---------------------------------------------------------------------------

async function runApiCommand(
  route: Parameters<typeof buildRequest>[0],
  params: Record<string, string>,
  allFlags: Record<string, any>,
): Promise<void> {
  const format = resolveOutputFormat(allFlags);

  const credentials = resolveCliCredentials(allFlags);

  const req = buildRequest(route, params, allFlags);

  const result = await httpRequest(
    credentials.apiUrl,
    req.method,
    req.urlPath,
    {
      body: req.body,
      queryParams: req.queryParams,
      authToken: credentials.apiToken,
    },
  );

  const exitCode = renderResult(route, params, result, format);
  if (exitCode !== 0) process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const rawArgs = process.argv.slice(2);
  const firstArg = rawArgs[0];

  if (firstArg === "-v" && rawArgs.length === 1) {
    console.log(readCliPackageVersion());
    return;
  }

  // ── Commands intercepted before Commander runs ──────────────────────
  // Intercepted before Commander runs — these handle their own flag parsing.

  if (firstArg === "init") {
    const format: OutputFormat = "table";
    try {
      const result = await init(rawArgs.slice(1));
      emitResult(result, format);
      if (!result.ok) process.exit(1);
    } catch (err: any) {
      handleError(err, format);
    }
    return;
  }

  if (firstArg === "describe") {
    const rest = rawArgs.slice(1);
    const flags = parseFlags(rest);
    const format = resolveOutputFormat(flags);
    try {
      const credentials = resolveCliCredentials(flags);
      const positional = (flags._ as string[]) ?? [];
      const result =
        positional.length === 0
          ? await describeAll(credentials.apiUrl, credentials.apiToken)
          : await describeOne(
              positional.join(" "),
              credentials.apiUrl,
              credentials.apiToken,
            );
      emitResult(result, format);
    } catch (err: any) {
      handleError(err, format);
    }
    return;
  }

  // ── Commander program for API commands ──────────────────────────────

  const program = new Command("sapporta")
    .version(readCliPackageVersion())
    // Declare global options so Commander doesn't confuse their values
    // with subcommand names
    .option(
      "--output-format <format>",
      "Output format: table (default) or json",
    )
    .option(
      "--input-body-json <json>",
      "JSON object to send as the request body for commands that accept one",
    )
    .option("--api-url <url>", "Server URL (default: http://localhost:3000)")
    .option(
      "--api-token <token>",
      "Bearer token for authenticated API requests",
    )
    .option(
      "--sapporta-project-dir <path>",
      "Project root directory (overrides auto-detection)",
    );

  registerRoutes(program, ROUTES, async (route, params, extraPositionals) => {
    const allFlags = parseFlags(process.argv.slice(2));
    allFlags._ = extraPositionals;

    const format = resolveOutputFormat(allFlags);
    try {
      await runApiCommand(route, params, allFlags);
    } catch (err: any) {
      handleError(err, format);
    }
  });

  program.addHelpText(
    "after",
    `
Local commands (no server required):
  init <name>                          Create a new project directory
API discovery:
  describe [route]                     List endpoints or describe one`,
  );

  if (!firstArg) {
    program.help();
  }

  await program.parseAsync(process.argv);
}

main();
