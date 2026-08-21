/**
 * Schema checks and field-ownership policy for row-scoped table APIs.
 *
 * Auth policy answers whether a caller may supply a field and whether a
 * referenced row is visible. Zod write parsing answers whether the resulting
 * value has the right type and presence. Generated writes apply auth policy
 * first, merge trusted server values, and then reach authoritative structural
 * parsing through the save pipeline. Keeping these questions separate allows
 * required auth-owned fields to be absent from client payloads and present in
 * prepared inserts.
 */

import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import { findPkColumn } from "../schema/pk.js";
import { columnBySqlName } from "../schema/column.js";
import type { ValidationErrorDetail } from "../rows/validate.js";
import {
  SCOPED_TO_USER_ID_SQL_COLUMN,
  WORKSPACE_ID_SQL_COLUMN,
  isRowScope,
  scopedToUserScopeColumn,
  systemManagedScopeFieldNames,
  workspaceScopeColumn,
  type ReferenceRule,
  type ResolvedReferenceFact,
  type RowScope,
} from "./row-scope.js";
import type { RequestDataAuthority } from "./request-data-authority.js";
import { RowScopePolicyError } from "./row-scope-policy-error.js";

export type AuthSchemaIssueCode =
  | "invalid_row_scope"
  | "missing_workspace_scope_column"
  | "missing_user_scope_column"
  | "system_managed_column_api_writable"
  | "unknown_reference_source_column"
  | "unregistered_reference_table"
  | "unsupported_reference_target_column"
  | "composite_reference"
  | "ambiguous_reference"
  | "conflicting_reference_rule";

export interface AuthSchemaIssue {
  table: string;
  column?: string;
  code: AuthSchemaIssueCode;
  message: string;
}

export class AuthSchemaValidationError extends Error {
  public readonly issues: readonly AuthSchemaIssue[];

  constructor(issues: readonly AuthSchemaIssue[]) {
    super(
      `Auth schema validation failed: ${issues
        .map(
          (issue) =>
            `${issue.table}${issue.column ? `.${issue.column}` : ""} [${issue.code}]: ${issue.message}`,
        )
        .join("; ")}`,
    );
    this.name = "AuthSchemaValidationError";
    this.issues = issues;
  }
}

export class ApiWritePolicyError extends Error {
  public readonly errors: readonly ValidationErrorDetail[];

  constructor(errors: readonly ValidationErrorDetail[]) {
    super(
      `API write policy failed: ${errors.map((error) => `${error.field}: ${error.message}`).join(", ")}`,
    );
    this.name = "ApiWritePolicyError";
    this.errors = errors;
  }
}

export interface ReferenceResolutionResult {
  references: ResolvedReferenceFact[];
  issues: AuthSchemaIssue[];
}

interface DrizzleReferenceFact {
  sourceColumn: string;
  targetTableName: string;
  targetColumn: string;
  sourceColumnRef: ResolvedReferenceFact["sourceColumnRef"];
  targetColumnRef: ResolvedReferenceFact["targetColumnRef"];
}

/**
 * Validates the auth-specific schema contract for every registered table.
 *
 * This checks required ownership columns, API-writable scope fields, and
 * reference metadata. It returns structured issues instead of throwing so boot
 * code can aggregate every schema problem in one pass.
 */
export function checkAuthSchemaDefinitions(
  tables: readonly TableDef[],
): AuthSchemaIssue[] {
  const issues: AuthSchemaIssue[] = [];

  for (const table of tables) {
    const rowScope = table.meta.rowScope;
    if (!isRowScope(rowScope)) {
      issues.push({
        table: table.sqlName,
        code: "invalid_row_scope",
        message: `Invalid row scope "${String(rowScope)}".`,
      });
      issues.push(...resolveTableReferences(table, tables).issues);
      continue;
    }

    issues.push(...checkScopeColumns(table, rowScope));

    issues.push(...resolveTableReferences(table, tables).issues);
  }

  return issues;
}

/**
 * Fails boot when any registered table violates Sapporta auth metadata rules.
 * `loadSapportaProject` runs this after schemas are loaded and before search
 * plans compile, so every schema problem lands in one aggregated report.
 */
export function assertAuthSchemaDefinitions(tables: readonly TableDef[]): void {
  const issues = checkAuthSchemaDefinitions(tables);
  if (issues.length > 0) {
    throw new AuthSchemaValidationError(issues);
  }
}

/**
 * Resolves all FK facts Sapporta auth can enforce for one source table.
 *
 * Drizzle FK metadata proves the physical relationship; `meta.references`
 * can add or refine the auth policy, including `apiSettable: false`.
 * Conflicts are reported as schema issues because an ambiguous reference
 * cannot be validated safely at request time.
 */
export function resolveTableReferences(
  table: TableDef,
  registeredTables: readonly TableDef[],
): ReferenceResolutionResult {
  const issues: AuthSchemaIssue[] = [];
  const references: ResolvedReferenceFact[] = [];
  const tablesByName = new Map(
    registeredTables.map((registered) => [registered.sqlName, registered]),
  );
  const explicitRules = table.meta.references;
  const explicitSourceColumns = new Set(Object.keys(explicitRules));
  const drizzleRefs = drizzleReferenceFacts(table, issues);
  const drizzleBySource = new Map<string, DrizzleReferenceFact>();

  for (const drizzleRef of drizzleRefs) {
    // One local column cannot have two FK meanings. If `activities.subject_id`
    // references both `accounts.id` and `contacts.id`, the schema is
    // contradictory and auth cannot know which target table's rows to check.
    // The same-column duplicate can also happen by declaring the same FK twice.
    if (drizzleBySource.has(drizzleRef.sourceColumn)) {
      issues.push({
        table: table.sqlName,
        column: drizzleRef.sourceColumn,
        code: "ambiguous_reference",
        message: "Multiple foreign keys use the same source column.",
      });
      continue;
    }
    drizzleBySource.set(drizzleRef.sourceColumn, drizzleRef);
  }

  for (const [sourceColumn, drizzleRef] of drizzleBySource) {
    const explicitRule = explicitRules[sourceColumn];
    const resolved = resolveReferenceFact({
      sourceTable: table,
      sourceColumn,
      drizzleRef,
      explicitRule,
      tablesByName,
      source: explicitRule ? "drizzle+meta" : "drizzle",
    });
    if (resolved.issue) issues.push(resolved.issue);
    if (resolved.reference) references.push(resolved.reference);
    explicitSourceColumns.delete(sourceColumn);
  }

  for (const sourceColumn of explicitSourceColumns) {
    const explicitRule = explicitRules[sourceColumn];
    const resolved = resolveReferenceFact({
      sourceTable: table,
      sourceColumn,
      explicitRule,
      tablesByName,
      source: "meta",
    });
    if (resolved.issue) issues.push(resolved.issue);
    if (resolved.reference) references.push(resolved.reference);
  }

  return { references, issues };
}

/**
 * Returns resolved reference facts or throws an `AuthSchemaValidationError`.
 * Use this from request-time security code where unresolved references mean
 * the application cannot safely decide FK visibility.
 */
export function requireResolvedTableReferences(
  table: TableDef,
  registeredTables: readonly TableDef[],
): ResolvedReferenceFact[] {
  const result = resolveTableReferences(table, registeredTables);
  if (result.issues.length > 0) {
    throw new AuthSchemaValidationError(result.issues);
  }
  return result.references;
}

/**
 * Returns policy violations caused by fields table API callers may not submit:
 * auth ownership columns and references marked `apiSettable: false`. This only
 * checks the public API write boundary; FK row
 * visibility is validated separately after trusted server values are merged.
 */
export function apiWritePolicyIssues(
  table: TableDef,
  payload: unknown,
  references: readonly ResolvedReferenceFact[] = [],
): ValidationErrorDetail[] {
  if (!isRecord(payload)) {
    return [{ field: "$", message: "Expected an object payload." }];
  }

  const errors: ValidationErrorDetail[] = [];
  const columns = getTableConfig(table.drizzle).columns;
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(payload, column.name)) continue;
    if (column.primary && column.hasDefault) {
      errors.push({
        field: column.name,
        message:
          "This primary key is generated and cannot be submitted through the table API.",
      });
    }
    if (table.meta.columns[column.name]?.apiWritable === false) {
      errors.push({
        field: column.name,
        message: "This field is not writable through the table API.",
      });
    }
  }
  for (const field of systemManagedScopeFieldNames()) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      errors.push({
        field,
        message:
          "This field is managed by Sapporta auth and cannot be submitted through the table API.",
      });
    }
  }

  for (const reference of references) {
    if (reference.apiSettable) continue;
    if (Object.prototype.hasOwnProperty.call(payload, reference.sourceColumn)) {
      errors.push({
        field: reference.sourceColumn,
        message:
          "This reference is managed by the server and cannot be submitted through the table API.",
      });
    }
  }

  return errors;
}

/**
 * Projects the API field-ownership rule for one column.
 *
 * `tableApiZod` uses this function to omit prohibited fields from generated
 * client types and OpenAPI. Request-time row security uses the corresponding
 * issue collector above to reject callers that submit those fields anyway.
 * Frontend editability is only a presentation of this server-owned rule.
 */
export function isApiWritableColumn(
  table: TableDef,
  column: { name: string; primary: boolean; hasDefault: boolean },
  references: readonly ResolvedReferenceFact[],
): boolean {
  if (systemManagedScopeFieldNames().includes(column.name)) return false;
  if (column.primary && column.hasDefault) return false;
  if (table.meta.columns[column.name]?.apiWritable === false) return false;
  return !references.some(
    (reference) =>
      reference.sourceColumn === column.name && !reference.apiSettable,
  );
}

/**
 * Enforces API write policy and returns a shallow copy of the accepted
 * object. Prefer row-security helpers for request handlers; this primitive is
 * useful when composing lower-level auth workflows.
 */
export function validateApiWriteInput(
  table: TableDef,
  payload: unknown,
  references: readonly ResolvedReferenceFact[] = [],
): Record<string, unknown> {
  const errors = apiWritePolicyIssues(table, payload, references);
  if (errors.length > 0) {
    throw new ApiWritePolicyError(errors);
  }
  return { ...(payload as Record<string, unknown>) };
}

export interface TrustedInsertValuesForDataAuthority {
  /** SQL column names for Drizzle insert/update payloads. */
  sql: Record<string, string>;
  /** TypeScript property names for schema-facing callers. */
  typescript: Record<string, string>;
}

/**
 * Computes trusted ownership fields for inserting a row using request data
 * authority. Values come only from `RequestDataAuthority`, never from
 * API input.
 *
 * The same fail-closed row-scope matrix applies to stamping as to reads:
 * system tables need system-global authority, workspace tables require
 * workspace-global authority, and user-scoped tables require workspace-user
 * authority.
 */
export function trustedInsertValuesForDataAuthority(
  dataAuthority: RequestDataAuthority,
  table: TableDef,
): TrustedInsertValuesForDataAuthority {
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

  if (rowScope === "systemGlobal") {
    if (!dataAuthority.rowAuthorities.systemGlobalOnly) {
      throw new RowScopePolicyError(table, dataAuthority);
    }
    return { sql: {}, typescript: {} };
  }

  const workspace = workspaceScopeColumn(table);
  if (!workspace) {
    throw new AuthSchemaValidationError([
      {
        table: table.sqlName,
        column: WORKSPACE_ID_SQL_COLUMN,
        code: "missing_workspace_scope_column",
        message: "Missing workspace scope column.",
      },
    ]);
  }

  const sqlValues: Record<string, string> = {};
  const typescriptValues: Record<string, string> = {};

  if (rowScope === "workspaceGlobal") {
    const workspaceAuthority = dataAuthority.rowAuthorities.workspaceGlobalOnly;
    if (!workspaceAuthority) {
      throw new RowScopePolicyError(table, dataAuthority);
    }
    sqlValues[workspace.sqlName] = workspaceAuthority.workspace.id;
    typescriptValues[workspace.propertyName ?? workspace.typescriptName] =
      workspaceAuthority.workspace.id;
  }

  if (rowScope === "workspaceUserScoped") {
    const userAuthority = dataAuthority.rowAuthorities.workspaceUserScoped;
    if (!userAuthority) {
      throw new RowScopePolicyError(table, dataAuthority);
    }
    const scopedToUser = scopedToUserScopeColumn(table);
    if (!scopedToUser) {
      throw new AuthSchemaValidationError([
        {
          table: table.sqlName,
          column: SCOPED_TO_USER_ID_SQL_COLUMN,
          code: "missing_user_scope_column",
          message: "Missing scoped-to-user column.",
        },
      ]);
    }
    sqlValues[workspace.sqlName] = userAuthority.workspace.id;
    typescriptValues[workspace.propertyName ?? workspace.typescriptName] =
      userAuthority.workspace.id;
    sqlValues[scopedToUser.sqlName] = userAuthority.user.id;
    typescriptValues[scopedToUser.propertyName ?? scopedToUser.typescriptName] =
      userAuthority.user.id;
  }

  return { sql: sqlValues, typescript: typescriptValues };
}

function checkScopeColumns(
  table: TableDef,
  rowScope: RowScope,
): AuthSchemaIssue[] {
  const issues: AuthSchemaIssue[] = [];
  if (rowScope === "workspaceGlobal" || rowScope === "workspaceUserScoped") {
    if (!workspaceScopeColumn(table)) {
      issues.push({
        table: table.sqlName,
        column: WORKSPACE_ID_SQL_COLUMN,
        code: "missing_workspace_scope_column",
        message: `${rowScope} tables must define ${WORKSPACE_ID_SQL_COLUMN}.`,
      });
    }
  }

  if (rowScope === "workspaceUserScoped" && !scopedToUserScopeColumn(table)) {
    issues.push({
      table: table.sqlName,
      column: SCOPED_TO_USER_ID_SQL_COLUMN,
      code: "missing_user_scope_column",
      message: `workspaceUserScoped tables must define ${SCOPED_TO_USER_ID_SQL_COLUMN}.`,
    });
  }

  for (const field of systemManagedScopeFieldNames()) {
    if (table.meta.columns[field]?.apiWritable === true) {
      issues.push({
        table: table.sqlName,
        column: field,
        code: "system_managed_column_api_writable",
        message:
          "Auth scope columns are system-managed and cannot be API-writable.",
      });
    }
  }

  return issues;
}

function drizzleReferenceFacts(
  table: TableDef,
  issues: AuthSchemaIssue[],
): DrizzleReferenceFact[] {
  const facts: DrizzleReferenceFact[] = [];
  const config = getTableConfig(table.drizzle);

  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    if (ref.columns.length !== 1 || ref.foreignColumns.length !== 1) {
      issues.push({
        table: table.sqlName,
        code: "composite_reference",
        message:
          "Composite foreign keys are not supported for auth reference validation.",
      });
      continue;
    }

    const sourceColumnRef = ref.columns[0];
    const targetColumnRef = ref.foreignColumns[0];
    if (!sourceColumnRef || !targetColumnRef) {
      issues.push({
        table: table.sqlName,
        code: "ambiguous_reference",
        message:
          "Foreign key metadata did not expose a single source and target column.",
      });
      continue;
    }

    facts.push({
      sourceColumn: sourceColumnRef.name,
      targetTableName: getTableConfig(targetColumnRef.table).name,
      targetColumn: targetColumnRef.name,
      sourceColumnRef,
      targetColumnRef,
    });
  }

  return facts;
}

function resolveReferenceFact(args: {
  sourceTable: TableDef;
  sourceColumn: string;
  drizzleRef?: DrizzleReferenceFact;
  explicitRule?: ReferenceRule;
  tablesByName: ReadonlyMap<string, TableDef>;
  source: ResolvedReferenceFact["source"];
}): { reference?: ResolvedReferenceFact; issue?: AuthSchemaIssue } {
  const sourceColumnRef = columnBySqlName(args.sourceTable, args.sourceColumn);
  if (!sourceColumnRef) {
    return {
      issue: {
        table: args.sourceTable.sqlName,
        column: args.sourceColumn,
        code: "unknown_reference_source_column",
        message: "Reference source column does not exist on the source table.",
      },
    };
  }

  const targetTableName =
    args.explicitRule?.table ?? args.drizzleRef?.targetTableName;
  if (!targetTableName) {
    return {
      issue: {
        table: args.sourceTable.sqlName,
        column: args.sourceColumn,
        code: "ambiguous_reference",
        message:
          "Reference target must come from Drizzle metadata or meta.references.",
      },
    };
  }

  const targetTable = args.tablesByName.get(targetTableName);
  if (!targetTable) {
    return {
      issue: {
        table: args.sourceTable.sqlName,
        column: args.sourceColumn,
        code: "unregistered_reference_table",
        message: `Reference target table "${targetTableName}" is not registered.`,
      },
    };
  }

  const explicitTargetColumn =
    args.explicitRule?.column ?? findPkColumn(targetTable).name;
  const targetColumn = args.drizzleRef?.targetColumn ?? explicitTargetColumn;

  if (
    args.drizzleRef &&
    args.explicitRule &&
    (args.explicitRule.table !== args.drizzleRef.targetTableName ||
      explicitTargetColumn !== args.drizzleRef.targetColumn)
  ) {
    return {
      issue: {
        table: args.sourceTable.sqlName,
        column: args.sourceColumn,
        code: "conflicting_reference_rule",
        message: "meta.references conflicts with Drizzle foreign-key metadata.",
      },
    };
  }

  const targetColumnRef = columnBySqlName(targetTable, targetColumn);
  if (!targetColumnRef) {
    return {
      issue: {
        table: args.sourceTable.sqlName,
        column: args.sourceColumn,
        code: "unsupported_reference_target_column",
        message: `Reference target column "${targetColumn}" does not exist on "${targetTable.sqlName}".`,
      },
    };
  }

  return {
    reference: {
      sourceTable: args.sourceTable,
      sourceColumn: args.sourceColumn,
      sourceColumnRef,
      targetTable,
      targetColumn,
      targetColumnRef,
      apiSettable: args.explicitRule?.apiSettable ?? true,
      source: args.source,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
