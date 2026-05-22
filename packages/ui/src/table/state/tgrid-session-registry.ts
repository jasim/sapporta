// Registry for table pages that need to reload from app-level dispatchers,
// such as the drawer's `createRecord` flow.
//
// This intentionally stores only the capability those dispatchers need.
// Every concrete `TGridSession` created by `createTGridSession` is reloadable,
// but the registry should not depend on the full session surface: runtime,
// query stores, CSV helpers, typed row helpers, or disposal. Keeping this as a
// small structural type makes it clear that global callers may only trigger a
// root-table refetch, not reach into a mounted table page's internals.
//
// Ownership rule: the mounted table page owns the real session state and its
// lifetime. This global registry is only a narrow command bridge back to that
// owner; it must not become a service locator for live grid/session state.

type TGridSessionReloadHandle = {
  reloadRows(): void;
};

const sessions = new Map<string, TGridSessionReloadHandle>();

export function registerTGridSession(
  rootTableName: string,
  session: TGridSessionReloadHandle,
) {
  sessions.set(rootTableName, session);
}

export function unregisterTGridSession(rootTableName: string) {
  sessions.delete(rootTableName);
}

export function reloadTGridRows(rootTableName: string) {
  sessions.get(rootTableName)?.reloadRows();
}
