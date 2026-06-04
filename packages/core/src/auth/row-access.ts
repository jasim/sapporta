import { and, eq, sql, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { TableDef } from "../schema/table.js";
import type { SapportaAuthIdentity } from "./context.js";
import {
  type AuthSchemaIssue,
  AuthSchemaValidationError,
  AuthPayloadPolicyError,
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

/**
 * Predicate for rows owned by the current user inside the active workspace.
 * Only valid for `workspaceUserScoped` tables.
 */
export function currentUserRows(auth: SapportaAuthIdentity, table: TableDef): SQL {
  assertRowScope(table, "workspaceUserScoped");
  const workspaceColumn = requireWorkspaceColumn(table);
  const scopedToUserColumn = requireScopedToUserColumn(table);
  return and(
    eq(workspaceColumn.column, auth.workspace.id),
    eq(scopedToUserColumn.column, auth.user.id),
  )!;
}

/**
 * Predicate for every row in the active workspace. Valid for workspace-scoped
 * tables and used by owner/framework flows that intentionally see all users'
 * rows in one workspace.
 */
export function allWorkspaceRows(auth: SapportaAuthIdentity, table: TableDef): SQL {
  const rowScope = assertKnownRowScope(table);
  if (rowScope !== "workspaceGlobal" && rowScope !== "workspaceUserScoped") {
    throw rowAccessError(table, `allWorkspaceRows cannot be used with ${rowScope} tables.`);
  }
  const workspaceColumn = requireWorkspaceColumn(table);
  return eq(workspaceColumn.column, auth.workspace.id);
}

/**
 * Predicate for system-global reference tables. These tables are visible
 * installation-wide and do not carry workspace ownership columns.
 */
export function allSystemRows(_auth: SapportaAuthIdentity, table: TableDef): SQL {
  assertRowScope(table, "systemGlobal");
  return sql`TRUE`;
}

/**
 * Chooses the row visibility predicate for one table and auth identity.
 *
 * `workspaceUserScoped` tables always resolve to current-user rows. Framework
 * route permission may decide whether a route can run, but it does not widen
 * row visibility.
 */
export function selectRowAccessPredicate(
  auth: SapportaAuthIdentity,
  table: TableDef,
): SQL {
  const rowScope = assertKnownRowScope(table);
  if (rowScope === "systemGlobal") return allSystemRows(auth, table);
  if (rowScope === "workspaceGlobal") return allWorkspaceRows(auth, table);
  return currentUserRows(auth, table);
}

/**
 * Chooses the row predicate used while validating a foreign-key target.
 * Kept separate from `selectRowAccessPredicate` so lookup/reference policy can
 * evolve independently from direct table access if needed.
 */
export function lookupRowAccessPredicate(
  auth: SapportaAuthIdentity,
  targetTable: TableDef,
): SQL {
  return selectRowAccessPredicate(auth, targetTable);
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
 * Verifies submitted FK values point to rows visible inside the active auth
 * boundary.
 *
 * This is stricter than checking row existence: every FK lookup is AND-composed
 * with the target table's row-access predicate. Client payload policy is also
 * enforced unless the caller passes `skipPayloadPolicy` after doing its own
 * client-vs-server sequencing.
 */
export async function validateForeignKeyReferences(
  db: BetterSQLite3Database,
  auth: SapportaAuthIdentity,
  sourceTable: TableDef,
  payload: unknown,
  registeredTables: readonly TableDef[],
  options: ForeignKeyValidationOptions = {},
): Promise<void> {
  if (!isRecord(payload)) {
    throw new AuthPayloadPolicyError([{ field: "$", message: "Expected an object payload." }]);
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

    const accessPredicate = lookupRowAccessPredicate(auth, reference.targetTable);
    const rows = await db
      .select({ id: reference.targetColumnRef })
      .from(reference.targetTable.drizzle)
      .where(and(eq(reference.targetColumnRef, value), accessPredicate))
      .limit(1);

    if (rows.length === 0) {
      validationErrors.push({
        field: reference.sourceColumn,
        message: "Referenced row does not exist or is not visible in the active auth boundary.",
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

function assertRowScope(table: TableDef, expected: ReturnType<typeof assertKnownRowScope>): void {
  const rowScope = assertKnownRowScope(table);
  if (rowScope !== expected) {
    throw rowAccessError(table, `Expected ${expected} row scope, got ${rowScope}.`);
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

function rowAccessError(table: TableDef, message: string): AuthSchemaValidationError {
  const issue: AuthSchemaIssue = {
    table: table.sqlName,
    code: "invalid_row_scope",
    message,
  };
  return new AuthSchemaValidationError([issue]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
