import { useSyncExternalStore } from "react";
import type { LevelSnapshot, LevelSourceState } from "@sapporta/grid";
import { ApiError } from "@sapporta/shared/client";
import type { TGridRowsByLevel } from "@/table/grid-adapter/tgrid-types";
import type { TGridSession } from "@/table/state/tgrid-session";

// Small status snapshot for page chrome.
// It is intentionally separate from row rendering so a loading spinner,
// record count, or error message can update without teaching those components
// about row loading details.
export type TGridSourceStatus = {
  status: LevelSourceState["status"];
  error: unknown;
  totalCount: number;
};

export function useTGridSourceStateField<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  T,
>(
  session: TGridSession<RowsByLevel, AppServices>,
  pick: (state: LevelSourceState) => T,
): T {
  return useSyncExternalStore(
    (cb) => session.rootSource.subscribe(cb),
    () => pick(session.rootSource.state()),
    () => pick(session.rootSource.state()),
  );
}

// Subscribe to one field from the root source snapshot.
// Use this when a component needs row data/count without caring about
// lifecycle-only state.
export function useTGridSourceField<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  T,
>(
  session: TGridSession<RowsByLevel, AppServices>,
  pick: (snapshot: LevelSnapshot) => T,
): T {
  return useTGridSourceStateField(session, (state) => pick(state.snapshot));
}

// Read the loading/error/count values usually needed by table page chrome.
export function useTGridSourceStatus<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(session: TGridSession<RowsByLevel, AppServices>): TGridSourceStatus {
  const status = useTGridSourceStateField(session, (state) => state.status);
  const error = useTGridSourceStateField(session, (state) =>
    "error" in state ? state.error : undefined,
  );
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
