import { capabilitiesFor } from "../types/capabilities";
import type { ColPolicy } from "../types/action";
import type { CellCursor, ColId, GridPath } from "../types/identity";
import type { RowCursor } from "../types/row-selection";
import type { DisplayedRows } from "../types/level-row";
import type { LevelSchema } from "../types/schema";
import type { LevelSourceState, SourceLoadResult } from "../data-sources/types";
import {
  firstFocusableRow,
  lastFocusableRow,
} from "../types/level-row-traversal";

export type LoadedRowsBoundaryEvent =
  | {
      readonly kind: "cell";
      readonly loadPath: GridPath;
      readonly direction: "before" | "after";
      readonly origin: CellCursor;
      readonly colPolicy: ColPolicy;
      readonly extend: boolean;
    }
  | {
      readonly kind: "row";
      readonly loadPath: GridPath;
      readonly direction: "before" | "after";
      readonly origin: RowCursor;
      readonly extend: boolean;
    };

export function createLoadedBoundaryRuntime(args: {
  readonly assertLive: () => void;
  readonly sourceState: (path: GridPath) => LevelSourceState;
  readonly sourceExists: (path: GridPath) => boolean;
  readonly displayedRows: (path: GridPath) => DisplayedRows;
  readonly schemaAt: (path: GridPath) => LevelSchema;
  readonly load?: (
    event: LoadedRowsBoundaryEvent,
  ) => Promise<SourceLoadResult> | false;
  readonly moveCell: (target: CellCursor, extend: boolean) => void;
  readonly revealCell: (target: CellCursor) => void;
  readonly moveRow: (target: RowCursor, extend: boolean) => void;
  readonly revealRow: (target: RowCursor) => void;
  readonly onObserverError?: (error: unknown) => void;
}) {
  // Only one landing intent can be current. The token prevents an older async
  // completion from moving a cursor after a newer request replaced it.
  let pending: {
    readonly event: LoadedRowsBoundaryEvent;
    readonly token: number;
  } | null = null;
  let nextToken = 0;

  function request(event: LoadedRowsBoundaryEvent): boolean {
    args.assertLive();
    // Repeated key events at the same boundary share the pending host load.
    if (pending && intentEqual(pending.event, event)) return true;
    if (!args.sourceExists(event.loadPath)) return false;
    if (args.sourceState(event.loadPath).status !== "ready") return false;
    const request = Object.freeze({ event, token: ++nextToken });
    pending = request;
    let load: Promise<SourceLoadResult> | false | undefined;
    try {
      load = args.load?.(event);
    } catch (error) {
      pending = null;
      args.onObserverError?.(error);
      return false;
    }
    if (!load) {
      if (pending?.token === request.token) pending = null;
      return false;
    }
    void load.then(
      (result) => {
        if (pending?.token !== request.token) return;
        if (result.kind === "ready") resolve(event.loadPath);
        else pending = null;
      },
      (error: unknown) => {
        if (pending?.token === request.token) pending = null;
        args.onObserverError?.(error);
      },
    );
    return true;
  }

  function resolve(path: GridPath): void {
    const request = pending;
    if (!request || request.event.loadPath !== path) return;
    const state = args.sourceState(path);
    // A source notification can arrive before its load promise settles. Keep
    // the intent until the state is stable and ready.
    if (state.status === "initialLoading" || state.status === "refreshing")
      return;
    if (state.status !== "ready") {
      pending = null;
      return;
    }
    const event = request.event;
    if (event.kind === "cell") {
      const target = cellTarget(event);
      pending = null;
      if (!target) return;
      args.moveCell(target, event.extend);
      args.revealCell(target);
      return;
    }
    const target = rowTarget(event);
    pending = null;
    if (!target) return;
    args.moveRow(target, event.extend);
    args.revealRow(target);
  }

  function cellTarget(
    event: Extract<LoadedRowsBoundaryEvent, { kind: "cell" }>,
  ): CellCursor | null {
    const displayed = args.displayedRows(event.loadPath);
    const row =
      event.direction === "after"
        ? firstFocusableRow(displayed, capabilitiesFor)
        : lastFocusableRow(displayed, capabilitiesFor);
    if (!row) return null;
    const colId = targetColumn(
      args.schemaAt(event.loadPath),
      event.origin.colId,
      event.colPolicy,
    );
    return colId ? { path: event.loadPath, rowId: row.id, colId } : null;
  }

  function rowTarget(
    event: Extract<LoadedRowsBoundaryEvent, { kind: "row" }>,
  ): RowCursor | null {
    const rows = args.displayedRows(event.loadPath).rows;
    if (event.direction === "after") {
      const row = rows.find((candidate) => candidate.rowSelectable);
      return row ? { path: event.loadPath, rowId: row.id } : null;
    }
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.rowSelectable) return { path: event.loadPath, rowId: row.id };
    }
    return null;
  }

  return {
    request,
    resolve,
    dispose: () => {
      pending = null;
    },
  };
}

function targetColumn(
  schema: LevelSchema,
  sourceColId: ColId,
  policy: ColPolicy,
): ColId | null {
  if (schema.columns.length === 0) return null;
  if (policy === "first") return schema.columns[0].id;
  if (policy === "last") return schema.columns[schema.columns.length - 1].id;
  return schema.columns.some((column) => column.id === sourceColId)
    ? sourceColId
    : schema.columns[0].id;
}

function intentEqual(a: LoadedRowsBoundaryEvent, b: LoadedRowsBoundaryEvent) {
  if (a.kind !== b.kind) return false;
  if (
    a.loadPath !== b.loadPath ||
    a.direction !== b.direction ||
    a.extend !== b.extend
  )
    return false;
  if (a.kind === "cell" && b.kind === "cell") {
    return (
      a.colPolicy === b.colPolicy &&
      a.origin.path === b.origin.path &&
      a.origin.rowId === b.origin.rowId &&
      a.origin.colId === b.origin.colId
    );
  }
  return (
    a.kind === "row" &&
    b.kind === "row" &&
    a.origin.path === b.origin.path &&
    a.origin.rowId === b.origin.rowId
  );
}
// Navigation across a host-owned loaded window.
//
// The coordinator asks this runtime to load when navigation reaches a loaded
// edge. The host/source publishes rows first and settles its promise second.
// This runtime then samples displayed rows and lands on the requested edge.
