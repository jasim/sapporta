import { resolve } from "node:path";
import { loadSchemas } from "../schema/loader.js";
import { checkSchemaDefinitions } from "../schema/check.js";
import type { OperationResult } from "../introspect/types.js";
import { parseFlags } from "./format.js";
import { resolveProjectContext } from "./project-context.js";
import { fromApiCodeDir } from "../project-paths.js";

/**
 * Validate project schemas statically.
 *
 * Route-based reports are ordinary shared contracts and app handlers, so they
 * are checked by TypeScript, OpenAPI generation, and app-level tests rather
 * than a Sapporta report-definition validator.
 */
export async function check(args: string[]): Promise<OperationResult> {
  const flags = parseFlags(args);
  const ctx = await resolveProjectContext(flags);

  if (!ctx.dir) {
    return {
      ok: false,
      error: "Cannot check an API-created project — it has no schema directory",
      code: "VALIDATION_FAILED",
    };
  }
  const projectDir = resolve(ctx.dir);
  const { schemaDir } = fromApiCodeDir(projectDir);

  let hasIssues = false;
  const allIssues: Record<string, unknown>[] = [];
  let textOutput = "";

  let schemas;
  try {
    schemas = await loadSchemas(schemaDir);
  } catch (err: unknown) {
    if (
      !err ||
      typeof err !== "object" ||
      !("code" in err) ||
      err.code !== "ENOENT"
    ) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Error loading schemas from ${schemaDir}: ${message}`,
        code: "INTERNAL",
      };
    }
  }

  if (schemas && schemas.tables.length > 0) {
    const schemaIssues = checkSchemaDefinitions(schemas.tables);

    textOutput += `\nChecking schemas: ${schemas.tables.length} table(s)\n`;
    if (schemaIssues.length === 0) {
      textOutput += "  \u2713 No issues found\n";
    } else {
      hasIssues = true;
      for (const issue of schemaIssues) {
        textOutput += `  \u2717 ${issue.table}.${issue.column}: ${issue.message}\n`;
        allIssues.push({
          type: "schema",
          table: issue.table,
          column: issue.column,
          message: issue.message,
        });
      }
    }
  }

  if (!schemas?.tables.length) {
    textOutput += `No schemas found in ${projectDir}\n`;
  }

  return {
    ok: true,
    data: allIssues,
    meta: {
      message: textOutput.trimEnd(),
      hasIssues,
      tableOutputHandled: true,
    },
  };
}
