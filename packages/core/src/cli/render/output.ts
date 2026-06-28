import { ErrorCode, OperationError } from "../../introspect/types.js";
import { formatTable } from "../format.js";
import type { CliCommandResult } from "../commands/types.js";

export type OutputFormat = "table" | "json";

export function resolveOutputFormat(
  flags: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): OutputFormat {
  const explicit = readString(flags.output) ?? env.SAPPORTA_OUTPUT_FORMAT;
  if (explicit === "json") return "json";
  if (explicit === "table") return "table";
  if (explicit !== undefined) {
    throw new OperationError(
      `--output must be table or json, got ${JSON.stringify(explicit)}`,
      ErrorCode.VALIDATION_FAILED,
    );
  }
  return process.stdout.isTTY ? "table" : "json";
}

export function renderCommandResult(
  result: CliCommandResult,
  format: OutputFormat,
): void {
  if (format === "json") {
    console.log(JSON.stringify(result.raw ?? resultToJsonEnvelope(result)));
    return;
  }

  if (result.message) {
    console.log(result.message);
  }

  if (!result.tableOutputHandled) {
    console.log(result.data.length > 0 ? formatTable(result.data) : "(empty)");
  }

  if (result.additionalOutput) {
    console.log(result.additionalOutput);
  }
}

export function renderCommandError(err: unknown, format: OutputFormat): never {
  const code = err instanceof OperationError ? err.code : ErrorCode.INTERNAL;
  const message = err instanceof Error ? err.message : String(err);
  const envelope = { ok: false as const, error: message, code };

  if (format === "json") {
    console.log(JSON.stringify(envelope));
  } else {
    console.error(`Error: ${message}`);
  }

  process.exit(err instanceof OperationError ? 1 : 2);
}

function resultToJsonEnvelope(result: CliCommandResult): unknown {
  return {
    ok: true,
    data: result.data,
    ...(result.message ||
    result.additionalOutput ||
    result.tableOutputHandled !== undefined
      ? {
          meta: {
            ...(result.message ? { message: result.message } : {}),
            ...(result.additionalOutput
              ? { additionalOutput: result.additionalOutput }
              : {}),
            ...(result.tableOutputHandled !== undefined
              ? { tableOutputHandled: result.tableOutputHandled }
              : {}),
          },
        }
      : {}),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
