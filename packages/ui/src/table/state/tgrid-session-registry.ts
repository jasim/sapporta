// Registry for table pages that need to reload from app-level dispatchers,
// such as the drawer's `createRecord` flow.

type ReloadableTGridSession = {
  reloadRows(): void;
};

const sessions = new Map<string, ReloadableTGridSession>();

export function registerTGridSession(
  rootTableName: string,
  session: ReloadableTGridSession,
) {
  sessions.set(rootTableName, session);
}

export function unregisterTGridSession(rootTableName: string) {
  sessions.delete(rootTableName);
}

export function reloadTGridRows(rootTableName: string) {
  sessions.get(rootTableName)?.reloadRows();
}
