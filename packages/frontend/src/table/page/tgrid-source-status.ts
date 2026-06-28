import { useSyncExternalStore } from "react";
import type { LevelSnapshot } from "@sapporta/grid";
import { ApiError } from "@sapporta/shared/client";
import type { TGridRowsByLevel } from "@/table/grid-adapter/tgrid-types";
import type { TGridSession } from "@/table/state/tgrid-session";

// Small status snapshot for page chrome.
// It is intentionally separate from row rendering so a loading spinner,
// record count, or error message can update without teaching those components
// about row loading details.
export type TGridSourceStatus = {
  status: LevelSnapshot["status"];
  error: unknown;
  totalCount: number;
};

// Subscribe to one field from the root data source.
// Use this when a component needs a narrow piece of loading state and should
// not re-render for unrelated source changes.
export function useTGridSourceField<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  T,
>(
  session: TGridSession<RowsByLevel, AppServices>,
  pick: (snapshot: LevelSnapshot) => T,
): T {
  return useSyncExternalStore(
    (cb) => session.rootSource.subscribe(cb),
    () => pick(session.rootSource.snapshot()),
    () => pick(session.rootSource.snapshot()),
  );
}

// Read the loading/error/count values usually needed by table page chrome.
export function useTGridSourceStatus<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(session: TGridSession<RowsByLevel, AppServices>): TGridSourceStatus {
  const status = useTGridSourceField(session, (snapshot) => snapshot.status);
  const error = useTGridSourceField(session, (snapshot) => snapshot.error);
  const totalCount = useTGridSourceField(
    session,
    (snapshot) => snapshot.pagination?.totalCount ?? 0,
  );
  return { status, error, totalCount };
}

// Turn a failed row request into text that can be shown near the table.
// Server-provided error bodies are preserved when available.
export function tableLoadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (isErrorBody(body)) {
      return body.code ? `${body.error} (${body.code})` : body.error;
    }
    return `Request failed with status ${err.status}`;
  }
  return err instanceof Error ? err.message : "Could not load rows.";
}

function isErrorBody(value: unknown): value is {
  error: string;
  code?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}
