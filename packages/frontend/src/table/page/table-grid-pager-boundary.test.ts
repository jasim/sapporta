// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CELL_EDITING_NO_SELECTION_GRID,
  createGridRuntime,
  inMemoryGridDataSource,
  makeRowId,
  rootPath,
  type GridRuntime,
  type GridSchema,
  type SourceLoadResult,
} from "@sapporta/grid";
import { controllerFor, cursorManagerFor } from "@sapporta/grid/advanced";
import type { TGridSession } from "../tgrid/tgrid-session";
import {
  createTableGridPagerBoundaryController,
  focusTableGrid,
  type TableGridPagerButtonRefs,
} from "./table-grid-pager-boundary";

type RowsByLevel = {
  rows: { id: string; name: string };
};

const path = rootPath("rows");
const runtimes: GridRuntime[] = [];
const schema: GridSchema = {
  rootLevel: "rows",
  levels: {
    rows: {
      name: "rows",
      rowHeaderColumn: "none",
      columns: [
        {
          id: "id",
          name: "ID",
          renderCell: ({ value }) => String(value ?? ""),
        },
        {
          id: "name",
          name: "Name",
          renderCell: ({ value }) => String(value ?? ""),
        },
      ],
      options: {},
      childLevels: [],
    },
  },
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function key(key: string): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  } as KeyboardEvent;
}

function setup(page = 1) {
  const previous = document.createElement("button");
  const next = document.createElement("button");
  document.body.append(previous, next);
  const buttonRefs: TableGridPagerButtonRefs = {
    previous: { current: previous },
    next: { current: next },
  };
  const boundary = createTableGridPagerBoundaryController<RowsByLevel>(
    "rows",
    buttonRefs,
  );
  const pageLoad = deferred<SourceLoadResult>();
  const setLevelPage = vi.fn(() => pageLoad.promise);
  let session!: TGridSession<RowsByLevel>;
  const runtime = createGridRuntime({
    schema,
    interaction: CELL_EDITING_NO_SELECTION_GRID,
    dataSource: inMemoryGridDataSource({
      schema,
      tree: [
        {
          rowKey: "a",
          levelName: "rows",
          columns: { id: "a", name: "Apple" },
        },
        {
          rowKey: "b",
          levelName: "rows",
          columns: { id: "b", name: "Banana" },
        },
      ],
      levels: {
        rows: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
    onLoadedRowsBoundary: (event) =>
      boundary.onLoadedRowsBoundary(event, "rows", session),
  });
  runtimes.push(runtime);
  session = {
    rootLevel: "rows",
    runtime,
    getQueryState: () => ({ page, pageSize: 25 }),
    setLevelPage,
  } as unknown as TGridSession<RowsByLevel>;

  return {
    runtime,
    boundary,
    pageLoad,
    setLevelPage,
    previous,
    next,
  };
}

async function resolveReady(
  runtime: GridRuntime,
  pageLoad: ReturnType<typeof deferred<SourceLoadResult>>,
): Promise<void> {
  const state = runtime.level(path).data.state();
  if (state.status !== "ready") throw new Error("expected ready rows");
  pageLoad.resolve({ kind: "ready", state });
  await pageLoad.promise;
  await Promise.resolve();
}

describe("table grid pager boundary controller", () => {
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
    document.body.replaceChildren();
  });

  it("pauses on Next and gives the exact page load back to grid landing", async () => {
    const { runtime, boundary, pageLoad, setLevelPage, next } = setup();
    const cursors = cursorManagerFor(runtime);
    const controller = controllerFor(runtime, path);
    const origin = {
      path,
      rowId: makeRowId(path, "b"),
      colId: "name",
    };
    cursors.moveCellCursorTo(origin);
    controller.flushEffects();

    controller.handleKey(key("ArrowDown"));

    expect(document.activeElement).toBe(next);
    expect(cursors.currentCellCursor()).toEqual(origin);
    expect(setLevelPage).not.toHaveBeenCalled();
    expect(boundary.onPagerButtonActivate("before")).toBe(false);

    expect(boundary.onPagerButtonActivate("after")).toBe(true);
    expect(setLevelPage).toHaveBeenCalledWith("rows", path, 2, 25);
    expect(cursors.currentCellCursor()).toEqual(origin);

    await resolveReady(runtime, pageLoad);

    expect(cursors.currentCellCursor()).toEqual({
      path,
      rowId: makeRowId(path, "a"),
      colId: "name",
    });
    expect(controller.effects.getState().map((effect) => effect.type)).toEqual([
      "focusContainer",
      "scrollFocusIntoView",
    ]);
  });

  it("pauses on Previous and lands on the last row after its page load", async () => {
    const { runtime, boundary, pageLoad, setLevelPage, previous } = setup(2);
    const cursors = cursorManagerFor(runtime);
    const origin = {
      path,
      rowId: makeRowId(path, "a"),
      colId: "name",
    };
    cursors.moveCellCursorTo(origin);

    controllerFor(runtime, path).handleKey(key("PageUp"));

    expect(document.activeElement).toBe(previous);
    expect(boundary.onPagerButtonActivate("before")).toBe(true);
    expect(setLevelPage).toHaveBeenCalledWith("rows", path, 1, 25);

    await resolveReady(runtime, pageLoad);

    expect(cursors.currentCellCursor()).toEqual({
      path,
      rowId: makeRowId(path, "b"),
      colId: "name",
    });
  });

  it("returns browser focus to the originating grid without changing its cursor", async () => {
    const { runtime, boundary, setLevelPage, next } = setup();
    const cursors = cursorManagerFor(runtime);
    const controller = controllerFor(runtime, path);
    const origin = {
      path,
      rowId: makeRowId(path, "b"),
      colId: "name",
    };
    cursors.moveCellCursorTo(origin);
    controller.flushEffects();

    controller.handleKey(key("ArrowDown"));

    expect(document.activeElement).toBe(next);
    boundary.onPagerBoundaryExit();
    focusTableGrid(runtime);
    expect(setLevelPage).not.toHaveBeenCalled();
    expect(cursors.currentCellCursor()).toEqual(origin);
    expect(controller.effects.getState()).toEqual([{ type: "focusContainer" }]);

    await Promise.resolve();
    expect(boundary.onPagerButtonActivate("after")).toBe(false);
  });

  it("cancels the grid landing when focus leaves the pager", async () => {
    const { runtime, boundary, setLevelPage } = setup();
    const cursors = cursorManagerFor(runtime);
    const origin = {
      path,
      rowId: makeRowId(path, "b"),
      colId: "name",
    };
    cursors.moveCellCursorTo(origin);

    controllerFor(runtime, path).handleKey(key("PageDown"));
    boundary.onPagerBoundaryExit();
    await Promise.resolve();

    expect(setLevelPage).not.toHaveBeenCalled();
    expect(cursors.currentCellCursor()).toEqual(origin);
    expect(boundary.onPagerButtonActivate("after")).toBe(false);
  });
});
