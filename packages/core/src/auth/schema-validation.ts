import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import { findPkColumn } from "../schema/pk.js";
import type { ValidationErrorDetail } from "../data/validate.js";
import {
  SCOPED_TO_USER_ID_SQL_COLUMN,
  WORKSPACE_ID_SQL_COLUMN,
  columnBySqlName,
  isRowScope,
  scopedToUserScopeColumn,
  systemManagedScopeFieldNames,
  workspaceScopeColumn,
  type ReferenceRule,
  type ResolvedReferenceFact,
  type RowScope,
} from "./row-scope.js";
import type { SapportaAuthIdentity } from "./context.js";

export type AuthSchemaIssueCode =
  | "invalid_row_scope"
  | "missing_workspace_scope_column"
  | "missing_user_scope_column"
  | "system_managed_column_client_editable"
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
        .map((issue) => `${issue.table}${issue.column ? `.${issue.column}` : ""}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "AuthSchemaValidationError";
    this.issues = issues;
  }
}

export class AuthPayloadPolicyError extends Error {
  public readonly errors: readonly ValidationErrorDetail[];

  constructor(errors: readonly ValidationErrorDetail[]) {
    super(`Auth payload policy failed: ${errors.map((error) => `${error.field}: ${error.message}`).join(", ")}`);
    this.name = "AuthPayloadPolicyError";
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
 * This checks required ownership columns, client-editable scope fields, and
 * reference metadata. It returns structured issues instead of throwing so boot
 * code can aggregate every schema problem in one pass.
 */
export function checkAuthSchemaDefinitions(tables: readonly TableDef[]): AuthSchemaIssue[] {
  const issues: AuthSchemaIssue[] = [];

  for (const table of tables) {
    const rowScope = table.meta.rowScope;
    issues.push(...checkScopeColumns(table, rowScope));

    issues.push(...resolveTableReferences(table, tables).issues);
  }

  return issues;
}

/**
 * Fails boot when any registered table violates Sapporta auth metadata rules.
 * Auth-enabled projects should call this after schemas are loaded and before
 * mounting framework APIs.
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
 * can add or refine the auth policy, including `clientCanSet: false`.
 * Conflicts are reported as schema issues because an ambiguous reference
 * cannot be validated safely at request time.
 */
export function resolveTableReferences(
  table: TableDef,
  registeredTables: readonly TableDef[],
): ReferenceResolutionResult {
  const issues: AuthSchemaIssue[] = [];
  const references: ResolvedReferenceFact[] = [];
  const tablesByName = new Map(registeredTables.map((registered) => [registered.sqlName, registered]));
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
 * Returns payload policy violations caused by fields clients are not trusted
 * to submit: auth ownership columns and references marked `clientCanSet:
 * false`. This only checks the client payload trust boundary; FK row
 * visibility is validated separately after trusted server values are merged.
 */
export function clientPayloadPolicyIssues(
  table: TableDef,
  payload: unknown,
  references: readonly ResolvedReferenceFact[] = [],
): ValidationErrorDetail[] {
  if (!isRecord(payload)) {
    return [{ field: "$", message: "Expected an object payload." }];
  }

  const errors: ValidationErrorDetail[] = [];
  for (const field of systemManagedScopeFieldNames()) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      errors.push({
        field,
        message: "This field is managed by Sapporta auth and cannot be submitted by clients.",
      });
    }
  }

  for (const reference of references) {
    if (reference.clientCanSet) continue;
    if (Object.prototype.hasOwnProperty.call(payload, reference.sourceColumn)) {
      errors.push({
        field: reference.sourceColumn,
        message: "This reference is managed by the server and cannot be submitted by clients.",
      });
    }
  }

  return errors;
}

/**
 * Enforces client payload policy and returns a shallow copy of the accepted
 * object. Prefer row-security helpers for request handlers; this primitive is
 * useful when composing lower-level auth workflows.
 */
export function validateClientPayloadPolicy(
  table: TableDef,
  payload: unknown,
  references: readonly ResolvedReferenceFact[] = [],
): Record<string, unknown> {
  const errors = clientPayloadPolicyIssues(table, payload, references);
  if (errors.length > 0) {
    throw new AuthPayloadPolicyError(errors);
  }
  return { ...(payload as Record<string, unknown>) };
}

export interface TrustedScopeInsertValues {
  /** SQL column names for Drizzle insert/update payloads. */
  sql: Record<string, string>;
  /** TypeScript property names for schema-facing callers. */
  typescript: Record<string, string>;
}

/**
 * Computes trusted ownership fields for inserting a row in the active auth
 * boundary. Values come only from `SapportaAuthIdentity`, never from client
 * input.
 */
export function trustedScopeInsertValues(
  auth: SapportaAuthIdentity,
  table: TableDef,
): TrustedScopeInsertValues {
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

  const sqlValues: Record<string, string> = {
    [workspace.sqlName]: auth.workspace.id,
  };
  const typescriptValues: Record<string, string> = {
    [workspace.propertyName ?? workspace.typescriptName]: auth.workspace.id,
  };

  if (rowScope === "workspaceUserScoped") {
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
    sqlValues[scopedToUser.sqlName] = auth.user.id;
    typescriptValues[scopedToUser.propertyName ?? scopedToUser.typescriptName] = auth.user.id;
  }

  return { sql: sqlValues, typescript: typescriptValues };
}

function checkScopeColumns(table: TableDef, rowScope: RowScope): AuthSchemaIssue[] {
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
    if (table.meta.columns[field]?.clientEditable === true) {
      issues.push({
        table: table.sqlName,
        column: field,
        code: "system_managed_column_client_editable",
        message: "Auth scope columns are system-managed and cannot be client-editable.",
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
        message: "Composite foreign keys are not supported for auth reference validation.",
      });
      continue;
    }

    const sourceColumnRef = ref.columns[0];
    const targetColumnRef = ref.foreignColumns[0];
    if (!sourceColumnRef || !targetColumnRef) {
      issues.push({
        table: table.sqlName,
        code: "ambiguous_reference",
        message: "Foreign key metadata did not expose a single source and target column.",
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

  const targetTableName = args.explicitRule?.table ?? args.drizzleRef?.targetTableName;
  if (!targetTableName) {
    return {
      issue: {
        table: args.sourceTable.sqlName,
        column: args.sourceColumn,
        code: "ambiguous_reference",
        message: "Reference target must come from Drizzle metadata or meta.references.",
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

  const explicitTargetColumn = args.explicitRule?.column ?? findPkColumn(targetTable).name;
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
      clientCanSet: args.explicitRule?.clientCanSet ?? true,
      source: args.source,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
