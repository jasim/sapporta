/**
 * App-level dispatchers — side-effect functions that coordinate between
 * stores, the API, and the router.
 *
 * These are plain functions (not hooks, not store methods) that can be
 * called from anywhere: event handlers, effects, other dispatchers.
 */

import { useSchemaStore } from "./schema-store";
import { useDrawerStore } from "./drawer-store";
import { getNavigate } from "./router-bridge";
import { refetchNewTable } from "../components/table-new/new-grid-registry";
import { fetchSchema, fetchProjectInfo } from "../services/schema";
import { createRow } from "../services/rows";
import { fetchReports } from "../services/reports";
import { ApiError } from "@sapporta/shared/client";

// ── Schema ──

export async function loadSchema(opts?: { force?: boolean }) {
  const store = useSchemaStore.getState();
  if (!opts?.force && (store.loaded || store.loading)) return;

  store.setLoading(true);
  try {
    const res = await fetchSchema();
    store.setTables(res.tables);
  } catch (err) {
    if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
      store.setError(`${err.status}: ${(err.body as { error: string }).error}`);
    } else if (err instanceof ApiError) {
      store.setError(`${err.status}: ${JSON.stringify(err.body)}`);
    } else {
      store.setError(err instanceof Error ? err.message : "Failed to load schema");
    }
  }
}

// ── Reports ──

export async function loadReports() {
  try {
    const res = await fetchReports();
    useSchemaStore.getState().setReports(res.reports);
  } catch {
    // Reports endpoint may not exist — non-fatal
  }
}

// ── Project info ──

export async function loadProjectInfo() {
  const info = await fetchProjectInfo();
  useSchemaStore.getState().setSlug(info.slug);
}

// ── Navigation ──

export function navigateToReport(reportName: string) {
  useSchemaStore.getState().setActiveReport(reportName);
  try {
    getNavigate()(`/reports/${reportName}`);
  } catch {
    // Router bridge not initialized
  }
}

export function navigateToTable(tableName: string) {
  useSchemaStore.getState().setActiveTable(tableName);
  try {
    getNavigate()(`/tables/${tableName}`);
  } catch {
    // Router bridge not initialized
  }
}

// ── Record CRUD ──

// createRecord bridges the RecordDrawer (which lives in AppShell, outside
// the table page) with the active new-grid registry.
export async function createRecord(tableName: string, data: Record<string, unknown>) {
  const res = await createRow(tableName, data);
  refetchNewTable(tableName);
  useDrawerStore.getState().close();
  try {
    getNavigate()(`/tables/${tableName}`, { replace: true });
  } catch {
    // Router bridge not initialized
  }
  return res.data;
}

// ── Drawer ──

export function openDrawerCreate(tableName: string) {
  useDrawerStore.getState().openCreate(tableName);
  try {
    getNavigate()(`/tables/${tableName}/new`);
  } catch {
    // Router bridge not initialized
  }
}

export function closeDrawer() {
  const tableName = useDrawerStore.getState().tableName;
  useDrawerStore.getState().close();
  if (tableName) {
    try {
      getNavigate()(`/tables/${tableName}`, { replace: true });
    } catch {
      // Router bridge not initialized
    }
  }
}
