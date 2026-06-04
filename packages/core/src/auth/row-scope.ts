import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";

export const rowScopes = [
  "workspaceUserScoped",
  "workspaceGlobal",
  "systemGlobal",
] as const;

export type RowScope = (typeof rowScopes)[number];

export const scopeColumnNames = {
  typescript: {
    workspaceId: "workspaceId",
    scopedToUserId: "scopedToUserId",
  },
  sql: {
    workspaceId: "workspace_id",
    scopedToUserId: "scoped_to_user_id",
  },
} as const;

export const WORKSPACE_ID_TS_COLUMN = scopeColumnNames.typescript.workspaceId;
export const SCOPED_TO_USER_ID_TS_COLUMN = scopeColumnNames.typescript.scopedToUserId;
export const WORKSPACE_ID_SQL_COLUMN = scopeColumnNames.sql.workspaceId;
export const SCOPED_TO_USER_ID_SQL_COLUMN = scopeColumnNames.sql.scopedToUserId;

export interface ReferenceRule {
  /** Registered Sapporta target table SQL name. */
  table: string;
  /** Target column SQL name. Defaults to the target table primary key. */
  column?: string;
  /** When false, clients may not submit this FK column on create/update. */
  clientCanSet?: boolean;
}

export type ReferenceSource = "drizzle" | "meta" | "drizzle+meta";

export interface ResolvedReferenceFact {
  sourceTable: TableDef;
  sourceColumn: string;
  sourceColumnRef: SQLiteColumn;
  targetTable: TableDef;
  targetColumn: string;
  targetColumnRef: SQLiteColumn;
  clientCanSet: boolean;
  source: ReferenceSource;
}

export interface ScopeColumnFact {
  sqlName: string;
  typescriptName: string;
  column: SQLiteColumn;
  propertyName: string | null;
}

export function isRowScope(value: unknown): value is RowScope {
  return typeof value === "string" && rowScopes.includes(value as RowScope);
}

export function columnBySqlName(table: TableDef, sqlName: string): SQLiteColumn | null {
  return getTableConfig(table.drizzle).columns.find((column) => column.name === sqlName) ?? null;
}

export function columnPropertyName(table: TableDef, column: SQLiteColumn): string | null {
  for (const [key, value] of Object.entries(table.drizzle as Record<string, unknown>)) {
    if (value === column) return key;
  }
  return null;
}

export function scopeColumnFact(
  table: TableDef,
  sqlName: string,
  typescriptName: string,
): ScopeColumnFact | null {
  const column = columnBySqlName(table, sqlName);
  if (!column) return null;
  return {
    sqlName,
    typescriptName,
    column,
    propertyName: columnPropertyName(table, column),
  };
}

export function workspaceScopeColumn(table: TableDef): ScopeColumnFact | null {
  return scopeColumnFact(table, WORKSPACE_ID_SQL_COLUMN, WORKSPACE_ID_TS_COLUMN);
}

export function scopedToUserScopeColumn(table: TableDef): ScopeColumnFact | null {
  return scopeColumnFact(table, SCOPED_TO_USER_ID_SQL_COLUMN, SCOPED_TO_USER_ID_TS_COLUMN);
}

export function systemManagedScopeFieldNames(): readonly string[] {
  return [
    WORKSPACE_ID_SQL_COLUMN,
    WORKSPACE_ID_TS_COLUMN,
    SCOPED_TO_USER_ID_SQL_COLUMN,
    SCOPED_TO_USER_ID_TS_COLUMN,
  ];
}
