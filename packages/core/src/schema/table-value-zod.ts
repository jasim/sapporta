/**
 * Canonical Zod vocabulary for values described by a `TableDef`.
 *
 * A Sapporta table has several valid object shapes. A caller-created row omits
 * server-owned fields. A prepared insert includes fields added by auth. A patch
 * contains only changed fields. A returned row is complete. Those object-level
 * projections live in `api/table-api-zod.ts` and
 * `data/table-write-zod.ts`. This module owns the column rules they share.
 *
 * `TableDef` supplies two kinds of facts. Drizzle owns SQL names, nullability,
 * defaults, keys, enum values, and storage types. Sapporta metadata and
 * `resolveColumnKind()` supply semantic value behavior. Every API and runtime
 * write schema calls the helpers below, so a number, select, date, or timestamp
 * cannot acquire a second validation meaning at another boundary.
 *
 * Dates and timestamps are accepted as JSON strings and returned as canonical
 * strings by Zod. The save pipeline persists that parsed output. Field
 * ownership, HTTP envelopes, auth reference checks, and application validation
 * belong to their respective boundary modules and are intentionally absent
 * here.
 */

import { type SQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  Temporal,
  formatCanonicalInstant,
  formatPlainDate,
  parseCanonicalInstant,
  parsePlainDate,
} from "@sapporta/shared/temporal";
import { resolveColumnKind } from "./resolve-kind.js";
import type { TableDef } from "./table.js";

export type ColumnValueZod = z.ZodType;
export type TableObjectZod = z.ZodObject<z.ZodRawShape>;

/**
 * Builds a stable Zod/OpenAPI component id from an SQL table name.
 *
 * Component ids identify schemas in generated documentation. This formatting
 * never changes the table name or the SQL column names used in payloads.
 */
export function tableZodComponentId(
  table: TableDef | string,
  suffix: string,
): string {
  const tableName = typeof table === "string" ? table : table.sqlName;
  const prefix = tableName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${prefix}${suffix}`;
}

/**
 * Returns the non-empty enum tuple declared on a Drizzle text column.
 *
 * `select("status", ["draft", "sent"])` and raw Drizzle
 * `text("status", { enum: [...] })` both expose `enumValues`. Schema metadata
 * extraction and Zod parsing read this same declaration.
 */
export function getColumnEnumValues(
  column: SQLiteColumn,
): readonly [string, ...string[]] | undefined {
  const values = (column as SQLiteColumn & { enumValues?: readonly string[] })
    .enumValues;
  return values && values.length > 0
    ? [values[0]!, ...values.slice(1)]
    : undefined;
}

/**
 * Derives the required, non-null Zod schema for one column value.
 *
 * This is the sole mapping for enums, semantic kinds, finite numbers,
 * booleans, text, canonical dates, and canonical timestamps. The schema is for
 * one present, non-null value. Row, insert, and patch presence rules are added
 * by the field and object helpers that call it.
 */
export function zodForColumnValue(
  table: TableDef,
  column: SQLiteColumn,
): ColumnValueZod {
  const enumValues = getColumnEnumValues(column);
  if (enumValues) return z.enum(enumValues);

  const kind = resolveColumnKind(table, column.name);
  if (!kind) {
    throw new Error(
      `Column "${column.name}" does not belong to table "${table.sqlName}".`,
    );
  }

  switch (kind) {
    case "number":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "text":
      return z.string();
    case "date":
      return z.preprocess(
        (value) =>
          value instanceof Temporal.PlainDate ? formatPlainDate(value) : value,
        z.string().transform((value, context) => {
          try {
            return formatPlainDate(parsePlainDate(value));
          } catch (error) {
            context.addIssue({
              code: "custom",
              message: `invalid ISO date: ${(error as Error).message}`,
            });
            return z.NEVER;
          }
        }),
      );
    case "timestamp":
      return z.preprocess(
        (value) =>
          value instanceof Temporal.Instant
            ? formatCanonicalInstant(value)
            : value,
        z.string().transform((value, context) => {
          try {
            return formatCanonicalInstant(parseCanonicalInstant(value));
          } catch (error) {
            context.addIssue({
              code: "custom",
              message: `invalid ISO timestamp: ${(error as Error).message}`,
            });
            return z.NEVER;
          }
        }),
      );
  }
}

/**
 * Projects one column into a returned-row field.
 *
 * Every returned row contains every column. Nullable columns therefore accept
 * `null`, while no row field becomes optional.
 */
export function zodForRowField(
  table: TableDef,
  column: SQLiteColumn,
): ColumnValueZod {
  const valueZod = zodForColumnValue(table, column);
  return column.notNull ? valueZod : valueZod.nullable();
}

/**
 * Adds insert presence rules to the canonical column value schema.
 *
 * Defaulted fields may be omitted. Nullable fields may be omitted or explicitly
 * set to null, whether or not they also have a default. All other fields are
 * required. API field ownership is intentionally absent because trusted writes
 * use the same rules.
 */
export function zodForInsertField(
  table: TableDef,
  column: SQLiteColumn,
): ColumnValueZod {
  const valueZod = zodForColumnValue(table, column);
  if (!column.notNull) return valueZod.nullable().optional();
  if (column.hasDefault) return valueZod.optional();
  return valueZod;
}
