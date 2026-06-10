import { and, eq, sql, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { TableDef } from "../schema/table.js";
import type { RowsAllowedForRequest } from "./rows-allowed-for-request.js";
import { RowScopePolicyError } from "./row-scope-policy-error.js";
import {
  AuthPayloadPolicyError,
  AuthSchemaValidationError,
  clientPayloadPolicyIssues,
  requireResolvedTableReferences,
} from "./schema-validation.js";
import {
  SCOPED_TO_USER_ID_SQL_COLUMN,
  WORKSPACE_ID_SQL_COLUMN,
  isRowScope,
  scopedToUserScopeColumn,
  workspaceScopeColumn,
} from "./row-scope.js";

export { RowScopePolicyError } from "./row-scope-policy-error.js";

/**
 * Row-scope predicates translate trusted request facts into SQL.
 *
 * This module deliberately ignores CASL. A route first asks CASL whether the
 * principal may use an action; row access then limits the database rows touched
 * by that already-authorized action.
 */
export function systemRows(
  rowsAllowedForRequest: RowsAllowedForRequest,
  table: TableDef,
): SQL {
  assertRowScope(table, "systemGlobal");
  return sql`TRUE`;
}

export function workspaceRows(
  rowsAllowedForRequest: RowsAllowedForRequest,
  table: TableDef,
): SQL {
  assertRowScope(table, "workspaceGlobal");
  if (
    rowsAllowedForRequest.kind !== "allowWorkspaceWideRows" &&
    rowsAllowedForRequest.kind !== "allowWorkspaceUserRows"
  ) {
    throw new RowScopePolicyError(table, rowsAllowedForRequest);
  }
  const workspaceColumn = requireWorkspaceColumn(table);
  return eq(workspaceColumn.column, rowsAllowedForRequest.workspace.id);
}

export function workspaceUserRows(
  rowsAllowedForRequest: RowsAllowedForRequest,
  table: TableDef,
): SQL {
  assertRowScope(table, "workspaceUserScoped");
  if (rowsAllowedForRequest.kind !== "allowWorkspaceUserRows") {
    throw new RowScopePolicyError(table, rowsAllowedForRequest);
  }
  const workspaceColumn = requireWorkspaceColumn(table);
  const scopedToUserColumn = requireScopedToUserColumn(table);
  return and(
    eq(workspaceColumn.column, rowsAllowedForRequest.workspace.id),
    eq(scopedToUserColumn.column, rowsAllowedForRequest.user.id),
  )!;
}

/**
 * Selects the predicate required by the table's declared row scope.
 *
 * The matrix is fail-closed:
 * - `systemGlobal` is visible for every rows-allowed value;
 * - `workspaceGlobal` requires workspace-wide or workspace-user rows;
 * - `workspaceUserScoped` requires workspace-user rows and filters by both
 *   workspace id and user id.
 */
export function selectRowAccessPredicate(
  rowsAllowedForRequest: RowsAllowedForRequest,
  table: TableDef,
): SQL {
  const rowScope = assertKnownRowScope(table);
  if (rowScope === "systemGlobal") return systemRows(rowsAllowedForRequest, table);
  if (rowScope === "workspaceGlobal") {
    return workspaceRows(rowsAllowedForRequest, table);
  }
  return workspaceUserRows(rowsAllowedForRequest, table);
}

export function lookupRowAccessPredicate(
  rowsAllowedForRequest: RowsAllowedForRequest,
  targetTable: TableDef,
): SQL {
  return selectRowAccessPredicate(rowsAllowedForRequest, targetTable);
}

export interface ForeignKeyValidationOptions {
  /**
   * When true, missing FK fields are ignored. Update patches should set this;
   * create bodies usually leave it false and still only validate submitted
   * non-null values.
   */
  partial?: boolean;
  /**
   * Skips client payload policy checks when the caller has already separated
   * client-submitted fields from trusted server-authored values.
   */
  skipPayloadPolicy?: boolean;
}

/**
 * Validates that submitted references point to rows visible to this request.
 *
 * Existence is not enough. A row id from another workspace, or another user's
 * user-scoped table, must behave like an invalid reference for this request.
 */
export async function validateForeignKeyReferences(
  db: BetterSQLite3Database,
  rowsAllowedForRequest: RowsAllowedForRequest,
  sourceTable: TableDef,
  payload: unknown,
  registeredTables: readonly TableDef[],
  options: ForeignKeyValidationOptions = {},
): Promise<void> {
  validateForeignKeyReferencesSync(
    db,
    rowsAllowedForRequest,
    sourceTable,
    payload,
    registeredTables,
    options,
  );
}

export function validateForeignKeyReferencesSync(
  db: BetterSQLite3Database,
  rowsAllowedForRequest: RowsAllowedForRequest,
  sourceTable: TableDef,
  payload: unknown,
  registeredTables: readonly TableDef[],
  options: ForeignKeyValidationOptions = {},
): void {
  if (!isRecord(payload)) {
    throw new AuthPayloadPolicyError([
      { field: "$", message: "Expected an object payload." },
    ]);
  }

  const references = requireResolvedTableReferences(sourceTable, registeredTables);
  if (options.skipPayloadPolicy !== true) {
    const policyIssues = clientPayloadPolicyIssues(sourceTable, payload, references);
    if (policyIssues.length > 0) {
      throw new AuthPayloadPolicyError(policyIssues);
    }
  }

  const validationErrors: Array<{ field: string; message: string }> = [];

  for (const reference of references) {
    if (!Object.prototype.hasOwnProperty.call(payload, reference.sourceColumn)) {
      if (options.partial) continue;
      continue;
    }

    const value = payload[reference.sourceColumn];
    if (value === null || value === undefined) continue;

    const accessPredicate = lookupRowAccessPredicate(
      rowsAllowedForRequest,
      reference.targetTable,
    );
    const rows = db
      .select({ id: reference.targetColumnRef })
      .from(reference.targetTable.drizzle)
      .where(and(eq(reference.targetColumnRef, value), accessPredicate))
      .limit(1)
      .all() as Array<{ id: unknown }>;

    if (rows.length === 0) {
      validationErrors.push({
        field: reference.sourceColumn,
        message: "Referenced row does not exist or is not visible in the active request scope.",
      });
    }
  }

  if (validationErrors.length > 0) {
    throw new AuthPayloadPolicyError(validationErrors);
  }
}

function assertKnownRowScope(table: TableDef) {
  const rowScope = table.meta.rowScope;
  if (!isRowScope(rowScope)) {
    throw new AuthSchemaValidationError([
      {
        table: table.sqlName,
        code: "invalid_row_scope",
        message: `Invalid row scope "${String(rowScope)}".`,
      },
    ]);
  }
  return rowScope;
}

function assertRowScope(
  table: TableDef,
  expected: ReturnType<typeof assertKnownRowScope>,
): void {
  const rowScope = assertKnownRowScope(table);
  if (rowScope !== expected) {
    throw new AuthSchemaValidationError([
      {
        table: table.sqlName,
        code: "invalid_row_scope",
        message: `Expected ${expected} row scope, got ${rowScope}.`,
      },
    ]);
  }
}

function requireWorkspaceColumn(table: TableDef) {
  const column = workspaceScopeColumn(table);
  if (!column) {
    throw new AuthSchemaValidationError([
      {
        table: table.sqlName,
        column: WORKSPACE_ID_SQL_COLUMN,
        code: "missing_workspace_scope_column",
        message: "Missing workspace scope column.",
      },
    ]);
  }
  return column;
}

function requireScopedToUserColumn(table: TableDef) {
  const column = scopedToUserScopeColumn(table);
  if (!column) {
    throw new AuthSchemaValidationError([
      {
        table: table.sqlName,
        column: SCOPED_TO_USER_ID_SQL_COLUMN,
        code: "missing_user_scope_column",
        message: "Missing scoped-to-user column.",
      },
    ]);
  }
  return column;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
