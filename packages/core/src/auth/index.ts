export {
  ownsActiveWorkspace,
  sapportaAuthRoles,
  type SapportaAuthContext,
  type SapportaAuthIdentity,
  type SapportaAuthMember,
  type SapportaAuthRole,
  type SapportaAuthSession,
  type SapportaAuthUser,
  type SapportaAuthWorkspace,
} from "./context.js";

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
  trustedScopeInsertValues,
  validateClientPayloadPolicy,
  type AuthSchemaIssue,
  type AuthSchemaIssueCode,
  type ReferenceResolutionResult,
  type TrustedScopeInsertValues,
} from "./schema-validation.js";

export {
  createRowSecurity,
  type CreateRowSecurityOptions,
  type InsertValuesOptions,
  type RowSecurity,
  type TableRowSecurity,
} from "./row-security.js";

export {
  allSystemRows,
  allWorkspaceRows,
  currentUserRows,
  lookupRowAccessPredicate,
  selectRowAccessPredicate,
  validateForeignKeyReferences,
  type ForeignKeyValidationOptions,
} from "./row-access.js";
