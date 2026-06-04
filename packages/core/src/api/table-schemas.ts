/**
 * Derive per-table Zod schemas from Drizzle column metadata.
 *
 * Three variants live here:
 *
 *   tableRowSchemaFor(def)
 *     Full row shape — what a SELECT returns. NOT NULL columns required;
 *     nullable columns `z.nullable()`. Used on response bodies.
 *
 *   tableInsertSchemaFor(def, { omit? })
 *     Insert shape — `id` and defaulted columns become optional, nullable
 *     columns become `.nullable().optional()`. `omit` drops server-supplied
 *     FKs (used by master/detail create — child rows don't carry the FK,
 *     the parent's new PK fills it in).
 *
 *   tableCreateBodySchemaFor(master, tables)
 *     Union: single row | array of rows | master-with-$details. The
 *     `$details` branch is only added for tables that declare `children`.
 *
 * Selects are honored: columns listed in `meta.selects` render as
 * `z.enum(options)`, so `account_type: "crypto"` is a validation error
 * instead of a silent miss.
 */

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { normalizeDataType } from "../schema/normalize-datatype.js";
import type { TableDef } from "../schema/table.js";

type JsonZod = z.ZodTypeAny;

export function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

function selectOptionsFor(
  def: TableDef,
  columnName: string,
): string[] | undefined {
  return def.meta.selects.find((s) => s.column === columnName)?.options;
}

function baseColumnSchema(
  def: TableDef,
  col: { name: string; columnType: string; dataType: string },
): JsonZod {
  const options = selectOptionsFor(def, col.name);
  if (options && options.length > 0) {
    return z.enum(options as [string, ...string[]]);
  }
  switch (normalizeDataType(col)) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "date":
    case "string":
    default:
      return z.string();
  }
}

export function tableRowSchemaFor(def: TableDef): z.ZodObject<z.ZodRawShape> {
  const config = getTableConfig(def.drizzle);
  const shape: Record<string, JsonZod> = {};
  for (const col of config.columns) {
    const base = baseColumnSchema(def, col);
    shape[col.name] = col.notNull ? base : base.nullable();
  }
  return z.object(shape).meta({ id: `${pascal(def.sqlName)}Row` });
}

export interface InsertSchemaOptions {
  omit?: readonly string[];
  /** Suffix applied to the generated OpenAPI component id. */
  componentIdSuffix?: string;
}

export function tableInsertSchemaFor(
  def: TableDef,
  options: InsertSchemaOptions = {},
): z.ZodObject<z.ZodRawShape> {
  const config = getTableConfig(def.drizzle);
  const shape: Record<string, JsonZod> = {};
  for (const col of config.columns) {
    const colBase = baseColumnSchema(def, col);
    // Server-supplied iff the column has a DB-side default. Autoincrement
    // integer pks have hasDefault=true; bare text pks don't, so the client
    // must supply the value (e.g. a UUID).
    const serverSupplied = col.hasDefault;
    shape[col.name] = serverSupplied
      ? colBase.optional()
      : col.notNull
        ? colBase
        : colBase.nullable().optional();
  }
  let schema: z.ZodObject<z.ZodRawShape> = z
    .object(shape)
    .strict()
    .meta({ id: `${pascal(def.sqlName)}Insert` });

  const omit = options.omit ?? [];
  if (omit.length > 0) {
    const omitShape: Record<string, true> = {};
    for (const k of omit) omitShape[k] = true;
    schema = schema.omit(omitShape) as z.ZodObject<z.ZodRawShape>;
  }
  if (options.componentIdSuffix) {
    schema = schema.meta({
      id: `${pascal(def.sqlName)}${options.componentIdSuffix}`,
    }) as z.ZodObject<z.ZodRawShape>;
  }
  return schema;
}

function findChild(
  master: TableDef,
  tables: readonly TableDef[],
  name: string,
): TableDef {
  const child = tables.find((d) => d.sqlName === name);
  if (!child) {
    throw new Error(
      `Table ${master.sqlName} declares child "${name}" but no matching TableDef was provided`,
    );
  }
  return child;
}

function unionOf(branches: JsonZod[], componentId: string): JsonZod {
  if (branches.length === 1) return branches[0]!;
  return z
    .union(branches as [JsonZod, JsonZod, ...JsonZod[]])
    .meta({ id: componentId });
}

/**
 * Create-body shape: one row | many rows | master-with-$details (per child).
 * Each $details branch omits the FK from the child insert schema — it's
 * filled in from the freshly-inserted master's PK on the server side.
 */
export function tableCreateBodySchemaFor(
  master: TableDef,
  tables: readonly TableDef[],
): JsonZod {
  const masterInsert = tableInsertSchemaFor(master);
  const branches: JsonZod[] = [
    masterInsert,
    z.array(masterInsert).meta({ id: `${pascal(master.sqlName)}InsertArray` }),
  ];

  for (const child of master.meta.children) {
    const childDef = findChild(master, tables, child.table);
    const childRows = z
      .array(
        tableInsertSchemaFor(childDef, {
          omit: [child.foreignKey],
          componentIdSuffix: `InsertWithout${pascal(child.foreignKey)}`,
        }),
      )
      .meta({
        id: `${pascal(master.sqlName)}${pascal(child.table)}DetailRows`,
      });

    branches.push(
      masterInsert
        .extend({
          $details: z
            .object({
              table: z.literal(childDef.sqlName),
              fk: z.literal(child.foreignKey),
              rows: childRows,
            })
            .strict(),
        })
        .strict()
        .meta({
          id: `${pascal(master.sqlName)}CreateWith${pascal(child.table)}`,
        }),
    );
  }

  return unionOf(branches, `${pascal(master.sqlName)}CreateBody`);
}

export function tableCreateResultSchemaFor(
  master: TableDef,
  tables: readonly TableDef[],
): JsonZod {
  const row = tableRowSchemaFor(master);
  const branches: JsonZod[] = [
    row,
    z.array(row).meta({ id: `${pascal(master.sqlName)}RowArray` }),
  ];

  for (const child of master.meta.children) {
    const childDef = findChild(master, tables, child.table);
    branches.push(
      z
        .object({
          master: row,
          details: z.array(tableRowSchemaFor(childDef)),
        })
        .strict()
        .meta({
          id: `${pascal(master.sqlName)}CreateWith${pascal(child.table)}Result`,
        }),
    );
  }

  return z
    .object({
      data: unionOf(branches, `${pascal(master.sqlName)}CreatePayload`),
    })
    .meta({ id: `${pascal(master.sqlName)}CreateOutput` });
}
