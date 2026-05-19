// Registry for table pages that need to be refreshed from app-level
// dispatchers, such as the drawer's `createRecord` flow.

import type { NewTableHandle } from "./new-table-state";

const handles = new Map<string, NewTableHandle>();

export function registerNewTable(name: string, handle: NewTableHandle) {
  handles.set(name, handle);
}

export function unregisterNewTable(name: string) {
  handles.delete(name);
}

export function refetchNewTable(name: string) {
  handles.get(name)?.refetch();
}
