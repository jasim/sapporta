// Registry for table pages that need to reload from app-level dispatchers,
// such as the drawer's `createRecord` flow.

import type { TGridSession } from "./tgrid-session";

const sessions = new Map<string, TGridSession>();

export function registerTGridSession(
  rootTableName: string,
  session: TGridSession,
) {
  sessions.set(rootTableName, session);
}

export function unregisterTGridSession(rootTableName: string) {
  sessions.delete(rootTableName);
}

export function reloadTGridRows(rootTableName: string) {
  sessions.get(rootTableName)?.reloadRows();
}
