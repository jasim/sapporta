import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import { columnPropertyName } from "../schema/column.js";
import type { TableDef } from "../schema/table.js";

export class UnknownRowFieldsError extends Error {
  readonly tableName: string;
  readonly fields: readonly string[];

  constructor(tableName: string, fields: readonly string[]) {
    super(`Unknown column(s) in '${tableName}': ${fields.join(", ")}`);
    this.name = "UnknownRowFieldsError";
    this.tableName = tableName;
    this.fields = fields;
  }
}

type RowField = {
  publicName: string;
  rowKey: string;
  column: SQLiteColumn;
};

/**
 * A validated translation between Sapporta's public SQL names and Drizzle's
 * TypeScript property names for a selected set of fields.
 */
export type ResolvedRowFields = {
  databaseSelection: Record<string, SQLiteColumn>;
  pick(row: Readonly<Record<string, unknown>>): Record<string, unknown>;
  toDatabaseValues(
    row: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
};

/**
 * Resolves public field names once so queries, writes, and returned rows agree.
 *
 * Application payloads, generated API schemas, metadata, validation issues,
 * filters, and row objects use SQL column names such as `workspace_id`.
 * Drizzle may expose that column through a property such as `workspaceId`.
 * This helper is the translation seam. Unknown public names fail explicitly,
 * selections are aliased to public names, write objects use Drizzle properties,
 * and returned rows are projected back to SQL names.
 */
export function resolveRowFields(
  table: TableDef,
  fieldNames: readonly string[],
): ResolvedRowFields {
  const columnsByName = new Map(
    getTableConfig(table.drizzle).columns.map((column) => [
      column.name,
      column,
    ]),
  );
  const unknownFields: string[] = [];
  const fields: RowField[] = [];

  for (const fieldName of fieldNames) {
    const column = columnsByName.get(fieldName);
    if (!column) {
      unknownFields.push(fieldName);
      continue;
    }
    fields.push({
      publicName: fieldName,
      rowKey: columnPropertyName(table, column) ?? fieldName,
      column,
    });
  }

  if (unknownFields.length > 0) {
    throw new UnknownRowFieldsError(table.sqlName, unknownFields);
  }

  return {
    databaseSelection: Object.fromEntries(
      fields.map((field) => [field.publicName, field.column]),
    ),
    pick(row) {
      return Object.fromEntries(
        fields.map((field) => [
          field.publicName,
          Object.prototype.hasOwnProperty.call(row, field.publicName)
            ? row[field.publicName]
            : row[field.rowKey],
        ]),
      );
    },
    toDatabaseValues(row) {
      return Object.fromEntries(
        fields
          .filter((field) => Object.hasOwn(row, field.publicName))
          .map((field) => [field.rowKey, row[field.publicName]]),
      );
    },
  };
}
