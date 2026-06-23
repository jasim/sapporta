import type { OperationResult } from "../introspect/types.js";

// ---------------------------------------------------------------------------
// CLI output formatting and flag parsing.
//
// Everything in this file is CLI-specific presentation logic — it converts
// structured OperationResults into human-readable terminal output or JSON.
// ---------------------------------------------------------------------------

export type OutputFormat = "table" | "json";

/**
 * Resolve the output format from flags, environment, and TTY detection.
 * Priority: --output-format flag > SAPPORTA_OUTPUT_FORMAT env > TTY detection.
 *
 * Non-TTY stdout (e.g. piped to another program or used by an AI agent)
 * defaults to JSON so agents get structured data without needing to pass flags.
 */
export function resolveOutputFormat(
  flags: Record<string, unknown>,
): OutputFormat {
  const flagValue = flags["output-format"];
  const explicit =
    typeof flagValue === "string"
      ? flagValue
      : process.env.SAPPORTA_OUTPUT_FORMAT;
  if (explicit === "json") return "json";
  if (explicit === "table") return "table";
  // Auto-detect: non-TTY defaults to JSON for agent consumption
  if (!process.stdout.isTTY) return "json";
  return "table";
}

/**
 * Format and emit an OperationResult to stdout.
 *
 * In table mode: reproduces the human-readable output the CLI has always produced.
 * In JSON mode: emits the full result envelope as a single JSON line.
 *
 * This is the ONLY place in the codebase that should call console.log for
 * command output. Commands themselves must never print directly.
 */
export function emitResult(
  result: OperationResult,
  format: OutputFormat,
): void {
  if (format === "json") {
    console.log(JSON.stringify(result));
    return;
  }

  // Table format: reproduce legacy behavior
  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    return;
  }

  if (result.meta?.message) {
    console.log(result.meta.message);
  }

  // Commands that produce complex multi-section output (e.g. report-execute,
  // report-describe) set meta.tableOutputHandled = true to signal that the
  // message and/or additionalOutput already contain the full rendered output.
  // In that case, skip the default formatTable call to avoid duplicate output.
  if (!result.meta?.tableOutputHandled && result.data.length > 0) {
    console.log(formatTable(result.data));
  }

  if (result.meta?.additionalOutput) {
    console.log(result.meta.additionalOutput);
  }

  // Emit error text to stderr (used by report-execute for warnings)
  if (result.meta?.errorText) {
    console.error(result.meta.errorText);
  }
}

/**
 * Parse --flag value pairs from argv.
 * Returns a map of flag → string value.
 * Positional args (no -- prefix) are collected under "_".
 *
 * All values are coerced to strings for a uniform interface —
 * callers can safely pass values as query params or compare against
 * string literals without worrying about type inference.
 */
export function parseFlags(argv: string[]): Record<string, unknown> {
  const result: Record<string, unknown> & { _: string[] } = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") break;
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=", 2);
      if (eqIndex !== -1) {
        // --key=value form
        result[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        const key = arg.slice(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
          result[key] = String(argv[i + 1]);
          i++;
        } else {
          result[key] = "true";
        }
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

/**
 * Format rows as a readable table for terminal output.
 */
export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(empty)";

  const columns = Object.keys(rows[0]);
  const widths = columns.map((col) => {
    const values = rows.map((row) => String(row[col] ?? "NULL"));
    return Math.max(col.length, ...values.map((v) => v.length));
  });

  const header = columns.map((col, i) => col.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((row) =>
    columns
      .map((col, i) => String(row[col] ?? "NULL").padEnd(widths[i]))
      .join("  "),
  );

  return [header, separator, ...body].join("\n");
}

/**
 * Truncate long string values in result rows to prevent context window overflow.
 * Only affects string values longer than maxLen; other types are left as-is.
 * Returns new row objects (does not mutate the originals).
 */
export function truncateValues(
  rows: Record<string, unknown>[],
  maxLen: number = 200,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const truncated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" && value.length > maxLen) {
        truncated[key] = value.slice(0, maxLen) + "...";
      } else {
        truncated[key] = value;
      }
    }
    return truncated;
  });
}
