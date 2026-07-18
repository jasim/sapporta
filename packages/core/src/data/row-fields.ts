import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import { columnPropertyName } from "../auth/row-scope.js";
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

/** A validated set of public row fields and their database columns. */
export type ResolvedRowFields = {
  databaseSelection: Record<string, SQLiteColumn>;
  pick(row: Readonly<Record<string, unknown>>): Record<string, unknown>;
};

/**
 * Resolves public field names once so database selections and returned rows use
 * the same names even when the table uses different TypeScript property names.
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
  };
}
