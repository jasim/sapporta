import { describe, expect, it, vi } from "vitest";
import { rootPath, type RowId } from "../types/identity";
import type { DisplayedRows, LevelRow } from "../types/level-row";
import type { DisplayedRowsInput, DisplayedRowsState } from "./types";
import { buildDisplayedRowSequence } from "./compute-displayed-rows";
import { createDisplayedRowsStore } from "./displayed-rows-store";

const path = rootPath("rows");
const rowA = row("a", { name: "A" });
const rowA2 = row("a", { name: "A2" });
const rowB = row("b", { name: "B" });

function input(): DisplayedRowsInput {
  return {
    path,
    schema: { name: "rows", columns: [], options: {}, childLevels: [] },
    sourceSnapshot: {
      status: "ready",
      nodes: [],
      serverManaged: { sort: false, filter: false, pagination: false },
    },
    phantomRows: [],
    viewState: {},
  };
}

function row(key: string, columns: Record<string, unknown>): LevelRow {
  return {
    kind: "data",
    id: `${path}#${key}` as RowId,
    rowSelectable: true,
    columns,
    hasChildren: false,
    source: { levelName: "rows", columns },
  };
}

function displayed(rows: LevelRow[]): DisplayedRows {
  return {
    rows,
    rowById: new Map(rows.map((r) => [r.id, r])),
    rowIndexById: new Map(rows.map((r, index) => [r.id, index])),
  };
}

function state(rows: LevelRow[]): DisplayedRowsState {
  const displayedRows = displayed(rows);
  return {
    displayedRows,
    displayedRowSequence: buildDisplayedRowSequence(displayedRows.rows),
  };
}

describe("createDisplayedRowsStore", () => {
  it("computes an initial snapshot", () => {
    const first = state([rowA]);
    const deriveDisplayedRowsState = vi.fn(() => first);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState,
    });

    expect(store.getDisplayedRows()).toBe(first.displayedRows);
    expect(store.getDisplayedRowSequence()).toBe(first.displayedRowSequence);
    expect(deriveDisplayedRowsState).toHaveBeenCalledTimes(1);
  });

  it("notifies row-sequence subscribers when row structure changes", () => {
    const first = state([rowA]);
    const second = state([rowA, rowB]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });
    const listener = vi.fn();
    store.subscribeDisplayedRowSequence(listener);

    store.invalidateDisplayedRows({ type: "source" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify row-sequence subscribers when row content changes only", () => {
    const sequence = buildDisplayedRowSequence([rowA]);
    const first: DisplayedRowsState = {
      displayedRows: displayed([rowA]),
      displayedRowSequence: sequence,
    };
    const second: DisplayedRowsState = {
      displayedRows: displayed([rowA2]),
      displayedRowSequence: sequence,
    };
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });
    const listener = vi.fn();
    store.subscribeDisplayedRowSequence(listener);

    store.invalidateDisplayedRows({ type: "source" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies row subscribers when that row reference changes", () => {
    const first = state([rowA]);
    const second = state([rowA2]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });
    const listener = vi.fn();
    store.subscribeDisplayedRow(rowA.id, listener);

    store.invalidateDisplayedRows({ type: "source" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies row subscribers when that row disappears", () => {
    const first = state([rowA, rowB]);
    const second = state([rowB]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });
    const listener = vi.fn();
    store.subscribeDisplayedRow(rowA.id, listener);

    store.invalidateDisplayedRows({ type: "source" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify unrelated row subscribers", () => {
    const first = state([rowA, rowB]);
    const second = state([rowA2, rowB]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });
    const listener = vi.fn();
    store.subscribeDisplayedRow(rowB.id, listener);

    store.invalidateDisplayedRows({ type: "source" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("dispose clears subscribers without notifying", () => {
    const first = state([rowA]);
    const second = state([rowA, rowB]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });
    const sequence = vi.fn();
    const rowListener = vi.fn();
    store.subscribeDisplayedRowSequence(sequence);
    store.subscribeDisplayedRow(rowA.id, rowListener);

    store.dispose();
    store.invalidateDisplayedRows({ type: "source" });

    expect(sequence).not.toHaveBeenCalled();
    expect(rowListener).not.toHaveBeenCalled();
  });
});
