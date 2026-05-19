import { z } from "zod";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import { resolveColumnKind } from "../schema/resolve-kind.js";
import type { ValueKind } from "@sapporta/shared/value-kind";
import {
  Temporal,
  parsePlainDate,
  parseCanonicalInstant,
  formatPlainDate,
  formatCanonicalInstant,
} from "@sapporta/shared/temporal";

/**
 * Build a Zod schema from a Drizzle table definition.
 *
 * Keys on `ColumnMeta.kind` when present; raw Drizzle columns derive their
 * kind from Drizzle's dataType. Date and timestamp fields are validated by
 * strict Temporal parsing plus canonical re-serialization — regex shape
 * alone would accept `2024-02-30` and `25:00:00`, values that are
 * shape-valid but not real points in time.
 *
 * User-provided `meta.validation` overrides everything.
 */
export function buildZodSchema(
  schema: TableDef,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (schema.meta.validation) {
    return schema.meta.validation;
  }

  const config = getTableConfig(schema.drizzle);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const col of config.columns) {
    if (col.primary && col.hasDefault) continue;
    const hasDefault = col.hasDefault;

    const kind = resolveColumnKind(schema, col.name);
    if (!kind) {
      throw new Error(
        `buildZodSchema: column "${col.name}" exists in Drizzle config but ` +
          `is unknown to meta.columns — meta/Drizzle column sets have drifted.`,
      );
    }
    let fieldSchema: z.ZodTypeAny = zodForKind(kind);

    // Validate select options if defined
    if (schema.meta.selects) {
      const selectMeta = schema.meta.selects.find(
        (s) => s.column === col.name,
      );
      if (selectMeta) {
        fieldSchema = z.enum(selectMeta.options as [string, ...string[]]);
      }
    }

    // Make nullable + optional if column allows null
    if (!col.notNull) {
      fieldSchema = fieldSchema.nullable().optional();
    }

    // Make optional if column has a default
    if (hasDefault && col.notNull) {
      fieldSchema = fieldSchema.optional();
    }

    shape[col.name] = fieldSchema;
  }

  return z.object(shape).strict();
}

/**
 * Zod schema for a single `ValueKind`. Numbers reject `NaN` and
 * `Infinity`; booleans are strict; dates and timestamps accept either a
 * Temporal object (already parsed) or a canonical string, and transform
 * the result into the canonical string form — SQLite TEXT is what
 * Drizzle eventually binds, and pre-canonicalizing here keeps lex order
 * equal to chronological order.
 */
function zodForKind(kind: ValueKind): z.ZodTypeAny {
  switch (kind) {
    case "number":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "text":
      return z.string();
    case "date":
      // The factory's customType accepts either Temporal.PlainDate
      // (post-boundary-parse) or an ISO string (pre-parse, e.g. a user's
      // raw JSON submission). Validation mirrors that shape — rejecting
      // either form of malformed input so callers get a 400 before the
      // value ever reaches Drizzle.
      return z.union([
        z.instanceof(Temporal.PlainDate),
        z.string().transform((s, ctx) => {
          try {
            return formatPlainDate(parsePlainDate(s));
          } catch (err) {
            ctx.addIssue({
              code: "custom",
              message: `invalid ISO date: ${(err as Error).message}`,
            });
            return z.NEVER;
          }
        }),
      ]);
    case "timestamp":
      return z.union([
        z.instanceof(Temporal.Instant),
        z.string().transform((s, ctx) => {
          try {
            return formatCanonicalInstant(parseCanonicalInstant(s));
          } catch (err) {
            ctx.addIssue({
              code: "custom",
              message: `invalid ISO timestamp: ${(err as Error).message}`,
            });
            return z.NEVER;
          }
        }),
      ]);
  }
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

/**
 * Validate a record against a table schema.
 * Returns an array of errors (empty if valid).
 */
export function validate(
  schema: TableDef,
  record: Record<string, unknown>,
  opts?: { partial?: boolean },
): ValidationErrorDetail[] {
  let zodSchema = buildZodSchema(schema);
  if (opts?.partial) {
    zodSchema = zodSchema.partial();
  }
  const result = zodSchema.safeParse(record);

  if (result.success) return [];

  return result.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}
