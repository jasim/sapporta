// Registry for table pages that need to be refreshed from app-level
// dispatchers, such as the drawer's `createRecord` flow.

import type { TableHandle } from "./table-state";

const handles = new Map<string, TableHandle>();

export function registerTable(name: string, handle: TableHandle) {
  handles.set(name, handle);
}

export function unregisterTable(name: string) {
  handles.delete(name);
}

export function refetchTable(name: string) {
  handles.get(name)?.refetch();
}
