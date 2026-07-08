import type { LookupCapabilities } from "@sapporta/grid/lookup";
import type { ColumnSchema, TableSchema } from "@sapporta/shared/contracts";
import type { LookupStore } from "../../lookup";
import { inferDisplayType } from "../model/column-types";
import { isRecordFormEditableColumn } from "./field-policy";

export type RecordFormFieldModel =
  | { kind: "text"; column: ColumnSchema }
  | { kind: "number"; column: ColumnSchema }
  | { kind: "currency"; column: ColumnSchema }
  | { kind: "percentage"; column: ColumnSchema }
  | { kind: "date"; column: ColumnSchema }
  | { kind: "timestamp"; column: ColumnSchema }
  | { kind: "checkbox"; column: ColumnSchema }
  | { kind: "select"; column: ColumnSchema; options: readonly string[] }
  | {
      kind: "foreignKey";
      column: ColumnSchema;
      lookup: LookupCapabilities;
    };

export function buildRecordFormFields(args: {
  table: TableSchema;
  lookups: LookupStore;
}): RecordFormFieldModel[] {
  const fields: RecordFormFieldModel[] = [];

  for (const column of args.table.columns) {
    if (!isRecordFormEditableColumn(column)) continue;
    const displayType = inferDisplayType(column);

    switch (displayType) {
      case "fk":
        fields.push({
          kind: "foreignKey",
          column,
          lookup: args.lookups.requireForeignKey({
            tableName: args.table.name,
            column,
          }),
        });
        break;
      case "select":
        fields.push({
          kind: "select",
          column,
          options: column.select?.options ?? [],
        });
        break;
      case "checkbox":
        fields.push({ kind: "checkbox", column });
        break;
      case "date":
        fields.push({ kind: "date", column });
        break;
      case "timestamp":
        fields.push({ kind: "timestamp", column });
        break;
      case "currency":
        fields.push({ kind: "currency", column });
        break;
      case "number":
        fields.push({ kind: "number", column });
        break;
      case "percentage":
        fields.push({ kind: "percentage", column });
        break;
      case "pk":
      case "text":
        fields.push({ kind: "text", column });
        break;
    }
  }

  return fields;
}
