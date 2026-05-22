import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";

// Core naming and typing primitives shared by all typed TGrid APIs.
// These are the small building blocks that connect levels, rows, and fields.
export type TableColumnName = TableColumnSchema["name"];

// Base row constraint for every typed row used in TGrid.
// Every specific level row shape must satisfy this structural base.
export type TGridTableRow = object;

// Map of all levels to their row types in one typed graph.
// The level ids become the key for runtime-safe row and editor behavior.
export type TGridRowsByLevel = Record<string, TGridTableRow>;

// Level id is any string key in the rows-by-level map.
// This id is used everywhere the runtime needs a stable level identity.
export type TGridLevelId<RowsByLevel extends TGridRowsByLevel = TGridRowsByLevel> =
  keyof RowsByLevel & string;

// A row field name picked from a specific row shape.
// Used to type-safe access columns, editors, and write handlers.
export type RowFieldName<Row extends object = Record<string, unknown>> =
  keyof Row & string;
