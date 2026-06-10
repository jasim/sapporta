export type { SapportaAbility, BuildAbility } from "./ability.js";
export type { SapportaAuthContext } from "./context.js";
export { createAuthContext } from "./create-auth-context.js";
export type { CreateAuthContextInput } from "./create-auth-context.js";
export { forbidUnless } from "./forbid.js";
export type {
  AuthWorkspace,
  Principal,
  SapportaAuthUser,
  WorkspaceMembership,
  WorkspaceRole,
} from "./principal.js";
export {
  anonymousPrincipal,
  userPrincipal,
} from "./principal.js";
export {
  allowOnlySystemWideRows,
  allowWorkspaceUserRows,
  allowWorkspaceWideRows,
} from "./rows-allowed-for-request.js";
export type { RowsAllowedForRequest } from "./rows-allowed-for-request.js";

export {
  SCOPED_TO_USER_ID_SQL_COLUMN,
  SCOPED_TO_USER_ID_TS_COLUMN,
  WORKSPACE_ID_SQL_COLUMN,
  WORKSPACE_ID_TS_COLUMN,
  columnBySqlName,
  columnPropertyName,
  isRowScope,
  rowScopes,
  scopeColumnFact,
  scopeColumnNames,
  scopedToUserScopeColumn,
  systemManagedScopeFieldNames,
  workspaceScopeColumn,
  type ReferenceRule,
  type ReferenceSource,
  type ResolvedReferenceFact,
  type RowScope,
  type ScopeColumnFact,
} from "./row-scope.js";

export {
  AuthPayloadPolicyError,
  AuthSchemaValidationError,
  assertAuthSchemaDefinitions,
  checkAuthSchemaDefinitions,
  clientPayloadPolicyIssues,
  requireResolvedTableReferences,
  resolveTableReferences,
  trustedInsertValuesForAllowedRows,
  validateClientPayloadPolicy,
  type AuthSchemaIssue,
  type AuthSchemaIssueCode,
  type ReferenceResolutionResult,
  type TrustedInsertValuesForAllowedRows,
} from "./schema-validation.js";

export {
  createRowSecurity,
  type CreateRowSecurityOptions,
  type InsertValuesOptions,
  type RowSecurity,
  type TableRowSecurity,
} from "./row-security.js";

export {
  lookupRowAccessPredicate,
  RowScopePolicyError,
  selectRowAccessPredicate,
  systemRows,
  validateForeignKeyReferences,
  workspaceRows,
  workspaceUserRows,
  type ForeignKeyValidationOptions,
} from "./row-access.js";
