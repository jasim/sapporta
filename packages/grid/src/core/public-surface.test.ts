import { describe, expect, expectTypeOf, it } from "vitest";
import * as advanced from "./advanced";
import {
  createGridRuntime,
  inMemoryGridDataSource,
  makeRowId,
  rootPath,
  ROW_MULTISELECT_LIST,
  type CellActivationGesture,
  type CellActivationTrigger,
  type GridActiveRow,
  type GridSchema,
  type LevelRowOfKind,
} from "./index";

type ActiveRowFor<Kind extends GridActiveRow["row"]["kind"]> = Extract<
  GridActiveRow,
  { row: { kind: Kind } }
>;

const publicCellActivationGesture: CellActivationGesture = "doubleClick";
const publicCellActivationTrigger: CellActivationTrigger = {
  kind: "pointer",
  gesture: publicCellActivationGesture,
};

const runtimeSchema: GridSchema = {
  rootLevel: "rows",
  levels: {
    rows: {
      name: "rows",
      rowHeaderColumn: "none",
      columns: [
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

function publicRuntime() {
  return createGridRuntime({
    schema: runtimeSchema,
    interaction: ROW_MULTISELECT_LIST,
    dataSource: inMemoryGridDataSource({
      schema: runtimeSchema,
      tree: [{ rowKey: "a", levelName: "rows", columns: { name: "Alpha" } }],
      levels: {
        rows: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
  });
}

describe("grid public surface", () => {
  it("represents every active-row kind through the public discriminated union", () => {
    expectTypeOf<LevelRowOfKind<"data">["kind"]>().toEqualTypeOf<"data">();
    expectTypeOf<LevelRowOfKind<"rollup">["kind"]>().toEqualTypeOf<"rollup">();
    expectTypeOf<
      LevelRowOfKind<"opening">["kind"]
    >().toEqualTypeOf<"opening">();
    expectTypeOf<
      LevelRowOfKind<"closing">["kind"]
    >().toEqualTypeOf<"closing">();
    expectTypeOf<
      LevelRowOfKind<"subtotal">["kind"]
    >().toEqualTypeOf<"subtotal">();
    expectTypeOf<LevelRowOfKind<"footer">["kind"]>().toEqualTypeOf<"footer">();
    expectTypeOf<
      LevelRowOfKind<"phantom">["kind"]
    >().toEqualTypeOf<"phantom">();
    expectTypeOf<ActiveRowFor<"data">["row"]["kind"]>().toEqualTypeOf<"data">();
    expectTypeOf<
      ActiveRowFor<"rollup">["row"]["kind"]
    >().toEqualTypeOf<"rollup">();
    expectTypeOf<
      ActiveRowFor<"opening">["row"]["kind"]
    >().toEqualTypeOf<"opening">();
    expectTypeOf<
      ActiveRowFor<"closing">["row"]["kind"]
    >().toEqualTypeOf<"closing">();
    expectTypeOf<
      ActiveRowFor<"subtotal">["row"]["kind"]
    >().toEqualTypeOf<"subtotal">();
    expectTypeOf<
      ActiveRowFor<"footer">["row"]["kind"]
    >().toEqualTypeOf<"footer">();
    expectTypeOf<
      ActiveRowFor<"phantom">["row"]["kind"]
    >().toEqualTypeOf<"phantom">();
  });
  it("retains the public cell activation type names", () => {
    expect(publicCellActivationTrigger).toEqual({
      kind: "pointer",
      gesture: "doubleClick",
    });
  });
  it("does not export removed internal grid APIs", async () => {
    const mod = (await import("./index")) as Record<string, unknown>;

    expect(mod).not.toHaveProperty("GridTree");
    expect(mod).not.toHaveProperty("applyTransaction");
    expect(mod).not.toHaveProperty("Transaction");
    expect(mod).not.toHaveProperty("initialSortByPath");
    expect(mod).not.toHaveProperty("initialFilterByPath");
    expect(mod).not.toHaveProperty("useDisplayedRows");
    expect(mod).not.toHaveProperty("computeDisplayedRows");
  });

  it("exports the runtime, React bridge, and grid data-source factories", async () => {
    const mod = (await import("./index")) as Record<string, unknown>;

    expect(typeof mod.createGridRuntime).toBe("function");
    expect(typeof mod.GridRuntimeProvider).toBe("function");
    expect(typeof mod.GridCopyContextMenu).toBe("function");
    expect(typeof mod.serializeGridCopyTargetToCsv).toBe("function");
    expect(typeof mod.resolveCellSelectionRectangle).toBe("function");
    expect(typeof mod.useGridRuntimeEffect).toBe("function");
    expect(typeof mod.useGridActiveRow).toBe("function");
    expect(typeof mod.useCellSelectionRectangle).toBe("function");
    expect(typeof mod.GridLevel).toBe("function");
    expect(typeof mod.inMemoryGridDataSource).toBe("function");
    expect(typeof mod.restGridDataSource).toBe("function");
    expect(mod).not.toHaveProperty("GridRuntimeRoot");
    expect(mod).not.toHaveProperty("useCommittedDisposableResource");
    expect(mod).not.toHaveProperty("useGridRuntimeResource");
    expect(mod).not.toHaveProperty("inMemoryLevelSource");
    expect(mod).not.toHaveProperty("restLevelSource");
    expect(mod).not.toHaveProperty("summarizeCellSelection");
  });

  it("publishes exactly the proposed GridRuntime keys", () => {
    const runtime = publicRuntime();

    expect(Object.keys(runtime).sort()).toEqual([
      "activeRow",
      "dispose",
      "interaction",
      "level",
      "on",
      "registeredLevels",
      "root",
      "rowOperations",
      "schema",
      "schemaAt",
      "subscribeActiveRow",
      "subscribeLevels",
    ]);
    expect(runtime).not.toHaveProperty("controllerFor");
    expect(runtime).not.toHaveProperty("cursorManager");
    expect(runtime).not.toHaveProperty("invalidateDisplayedRows");
    expect(runtime).not.toHaveProperty("requestLoadedRowsBoundary");
    expect(runtime).not.toHaveProperty("sourceFor");
  });

  it("exposes supported advanced composition without private runtime ports", () => {
    expect(Object.keys(advanced).sort()).toEqual([
      "applyCursorContinuation",
      "cellActivationFor",
      "controllerFor",
      "createPhantomChannel",
      "createPhantomRowLifecycle",
      "cursorManagerFor",
      "materializedChildren",
      "planCursorContinuationForRowRemoval",
    ]);
    expect(advanced).not.toHaveProperty("runtimeInternalsFor");
    expect(advanced).not.toHaveProperty("createGridCoordinator");
    expect(advanced).not.toHaveProperty("invalidateDisplayedRows");
    expect(advanced).not.toHaveProperty("requestLoadedRowsBoundary");

    const runtime = publicRuntime();
    const path = rootPath("rows");
    const rowId = makeRowId(path, "a");
    const cursors = advanced.cursorManagerFor(runtime);
    cursors.moveRowCursorTo({ path, rowId });

    expect(cursors.currentRowCursor()).toEqual({ path, rowId });
    expect(advanced.cursorManagerFor(runtime)).toBe(cursors);
    expect(advanced.controllerFor(runtime, path)).toBe(
      advanced.controllerFor(runtime, path),
    );
  });

  it("returns frozen schema and interaction snapshots", () => {
    const runtime = publicRuntime();
    const level = runtime.schema.levels.rows;

    expect(Object.isFrozen(runtime.schema)).toBe(true);
    expect(Object.isFrozen(runtime.schema.levels)).toBe(true);
    expect(Object.isFrozen(level)).toBe(true);
    expect(Object.isFrozen(level.columns)).toBe(true);
    expect(Object.isFrozen(level.columns[0])).toBe(true);
    expect(Object.isFrozen(level.options)).toBe(true);
    expect(Object.isFrozen(level.childLevels)).toBe(true);
    expect(Object.isFrozen(runtime.interaction)).toBe(true);
    expect(Object.isFrozen(runtime.interaction.activeRow)).toBe(true);
    expect(Object.isFrozen(runtime.interaction.selectedRows)).toBe(true);
    expect(runtime.interaction.activeRow).not.toHaveProperty("activation");
  });
});
