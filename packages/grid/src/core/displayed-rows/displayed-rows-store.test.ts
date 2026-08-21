import { describe, expect, it, vi } from "vitest";
import { makeRowId, rootPath } from "../types/identity";
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
    schema: {
      name: "rows",
      columns: [],
      rowHeaderColumn: "none",
      options: {},
      childLevels: [],
    },
    sourceSnapshot: {
      nodes: [],
    },
    phantomRows: [],
    viewState: {},
  };
}

function row(key: string, columns: Record<string, unknown>): LevelRow {
  return {
    kind: "data",
    id: makeRowId(path, key),
    rowSelectable: true,
    columns,
    hasChildren: false,
    source: { rowKey: key, levelName: "rows", columns },
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

  it("notifies full-snapshot subscribers when row content changes", () => {
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
    store.subscribeDisplayedRows(listener);

    store.invalidateDisplayedRows({ type: "source" });

    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not notify full-snapshot subscribers when the snapshot is reused", () => {
    const first = state([rowA]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi.fn(() => first),
    });
    const listener = vi.fn();
    store.subscribeDisplayedRows(listener);

    store.invalidateDisplayedRows({ type: "source" });

    expect(listener).not.toHaveBeenCalled();
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

  it("reports throwing sequence and row subscribers and continues each list", () => {
    const first = state([rowA]);
    const second = state([rowA2, rowB]);
    const sequenceError = new Error("sequence subscriber");
    const rowError = new Error("row subscriber");
    const report = vi.fn();
    const sequenceLater = vi.fn();
    const rowLater = vi.fn();
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
      onObserverError: report,
    });
    store.subscribeDisplayedRowSequence(() => {
      throw sequenceError;
    });
    store.subscribeDisplayedRowSequence(sequenceLater);
    store.subscribeDisplayedRow(rowA.id, () => {
      throw rowError;
    });
    store.subscribeDisplayedRow(rowA.id, rowLater);

    expect(() =>
      store.invalidateDisplayedRows({ type: "source" }),
    ).not.toThrow();
    expect(sequenceLater).toHaveBeenCalledOnce();
    expect(rowLater).toHaveBeenCalledOnce();
    expect(report).toHaveBeenNthCalledWith(1, sequenceError);
    expect(report).toHaveBeenNthCalledWith(2, rowError);
  });

  it("keeps duplicate sequence callbacks independently registered", () => {
    const first = state([rowA]);
    const second = state([rowA, rowB]);
    const third = state([rowA]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second)
        .mockReturnValueOnce(third),
    });
    const subscriber = vi.fn();
    const unsubscribeFirst = store.subscribeDisplayedRowSequence(subscriber);
    const unsubscribeSecond = store.subscribeDisplayedRowSequence(subscriber);

    store.invalidateDisplayedRows({ type: "source" });
    expect(subscriber).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    unsubscribeFirst();
    store.invalidateDisplayedRows({ type: "source" });
    expect(subscriber).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
  });

  it("dispose is idempotent and prevents later subscriptions", () => {
    const first = state([rowA]);
    const second = state([rowA, rowB]);
    const store = createDisplayedRowsStore({
      readInput: input,
      deriveDisplayedRowsState: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });
    const rows = vi.fn();
    const sequence = vi.fn();
    const rowListener = vi.fn();
    store.subscribeDisplayedRows(rows);
    store.subscribeDisplayedRowSequence(sequence);
    store.subscribeDisplayedRow(rowA.id, rowListener);

    store.dispose();
    store.dispose();
    store.subscribeDisplayedRows(rows);
    store.subscribeDisplayedRowSequence(sequence);
    store.subscribeDisplayedRow(rowA.id, rowListener);
    store.invalidateDisplayedRows({ type: "source" });

    expect(rows).not.toHaveBeenCalled();
    expect(sequence).not.toHaveBeenCalled();
    expect(rowListener).not.toHaveBeenCalled();
  });
});
