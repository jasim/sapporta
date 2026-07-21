/**
 * Authoritative parsing and application validation for table writes.
 *
 * Browser draft parsing and generated API schemas provide early feedback and
 * describe caller-visible payloads. This module decides whether a prepared row
 * can reach Drizzle. Generated routes, direct scoped-row operations, and
 * master-detail writes all converge here through `savePipeline()`.
 */

import type { TableDef } from "../schema/table.js";
import {
  fieldIssuesFromZodError,
  type FieldIssue,
} from "@sapporta/shared/validation";
import { tableWriteZod } from "./table-write-zod.js";
import { rejectControlChars } from "./sanitize.js";

/** @deprecated Use FieldIssue from @sapporta/shared/validation. */
export type ValidationErrorDetail = FieldIssue;

export type TableWriteParseResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; issues: ValidationErrorDetail[] };

/**
 * Parses one insert or update patch at the authoritative save boundary.
 *
 * Control characters are rejected first. `tableWriteZod` then enforces table
 * structure and canonicalizes values such as dates and timestamps. Application
 * validation sees that parsed result and may add operation-aware issues. A
 * successful result contains the same parsed data that the save pipeline will
 * persist; the pre-parse input is never substituted back in.
 */
export function parseTableWrite(
  table: TableDef,
  record: Record<string, unknown>,
  operation: "insert" | "patch",
): TableWriteParseResult {
  const controlCharacterIssues: ValidationErrorDetail[] = [];
  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== "string") continue;
    try {
      rejectControlChars(value);
    } catch {
      controlCharacterIssues.push({
        field,
        message: "Value contains control characters",
      });
    }
  }
  if (controlCharacterIssues.length > 0) {
    return { success: false, issues: controlCharacterIssues };
  }

  const writeZod =
    operation === "insert"
      ? tableWriteZod.forInsert(table)
      : tableWriteZod.forPatch(table);
  const result = writeZod.safeParse(record);
  if (!result.success) {
    return {
      success: false,
      issues: fieldIssuesFromZodError(result.error),
    };
  }

  const applicationIssues: ValidationErrorDetail[] = [];
  runApplicationValidation(
    table,
    result.data as Record<string, unknown>,
    operation,
    applicationIssues,
  );
  return applicationIssues.length > 0
    ? { success: false, issues: applicationIssues }
    : { success: true, data: result.data as Record<string, unknown> };
}

function runApplicationValidation(
  table: TableDef,
  value: Record<string, unknown>,
  operation: "insert" | "patch",
  issues: ValidationErrorDetail[],
): void {
  if (!table.validate) return;
  const context = {
    operation,
    addIssue(field: string, message: string) {
      issues.push({ field, message });
    },
  };
  table.validate(value, context);
}
