/**
 * Aggregate router consumed by `@sapporta/ui` and any generic frontend
 * via `createApiClient(uiContract)`. Pure pass-through — every route
 * lives in its own routes file; this file only namespaces them so the
 * resulting typed proxy has stable method names (`uiClient.listRows`,
 * `uiClient.lookup`, etc.).
 */

import { initContract } from "@sapporta/rest-core";
import {
  getAuthBootstrapStatusRoute,
  getAuthContextRoute,
  listAuthTokensRoute,
  createAuthTokenRoute,
  revokeAuthTokenRoute,
  switchActiveWorkspaceRoute,
} from "./auth-routes.js";
import {
  getTableRoute,
  listTablesRoute,
  projectInfoRoute,
  sqlRoute,
  tableIndexesRoute,
  tableSampleRoute,
} from "./meta-routes.js";
import {
  countRoute,
  createRowRoute,
  deleteRowRoute,
  getRowRoute,
  listRowsRoute,
  lookupRoute,
  updateRowRoute,
} from "./table-routes.js";

const c = initContract();

export const uiContract = c.router({
  getAuthBootstrapStatus: getAuthBootstrapStatusRoute,
  getAuthContext: getAuthContextRoute,
  switchActiveWorkspace: switchActiveWorkspaceRoute,
  listAuthTokens: listAuthTokensRoute,
  createAuthToken: createAuthTokenRoute,
  revokeAuthToken: revokeAuthTokenRoute,

  projectInfo: projectInfoRoute,
  listTables: listTablesRoute,
  getTable: getTableRoute,
  tableSample: tableSampleRoute,
  tableIndexes: tableIndexesRoute,
  sql: sqlRoute,

  listRows: listRowsRoute,
  getRow: getRowRoute,
  createRow: createRowRoute,
  updateRow: updateRowRoute,
  deleteRow: deleteRowRoute,
  lookup: lookupRoute,
  count: countRoute,
});

export type UiContract = typeof uiContract;
