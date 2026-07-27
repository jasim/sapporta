// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { columnPreset } from "../../column-preset";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { createGridRuntime, runtimeInternalsFor } from "../runtime/runtime";
import { makeLevelRowId, makeRowId, rootPath } from "../types/identity";
import type { GridSchema } from "../types/schema";
import type { CellSelectionRectangle } from "../types/selection";
import { GridLevel } from "./GridLevel";
import {
  GridRuntimeProvider,
  useCellSelectionRectangle,
} from "./GridRuntimeProvider";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const path = rootPath("rows");
const firstRowId = makeRowId(path, "one");
const secondRowId = makeRowId(path, "two");
const schema: GridSchema = {
  rootLevel: "rows",
  levels: {
    rows: {
      name: "rows",
      rowHeaderColumn: "none",
      columns: [
        columnPreset.number({
          id: "amount",
          name: "Amount",
        }),
      ],
      options: { allowPhantoms: true },
      childLevels: [],
    },
  },
};

describe("GridLevel selected-cell summary", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;
  let runtime: ReturnType<typeof createSummaryRuntime> | null = null;

  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
    runtime?.dispose();
    runtime = null;
  });

  it("appears, reacts to displayed values and drafts, and disappears", async () => {
    runtime = createSummaryRuntime();
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridLevel, {
          path,
          chrome: columnPreset.chrome(),
        }),
      }),
    );

    expect(summaryBand(mounted.container)).toBeNull();

    await act(async () => {
      runtimeInternalsFor(runtime!).cursorManager.setCellRange(
        path,
        { rowId: firstRowId, colId: "amount" },
        { rowId: secondRowId, colId: "amount" },
      );
    });
    expect(summaryText(mounted.container)).toBe("Sum5");

    await act(async () => {
      runtime!.root.writeCell({ rowId: firstRowId, colId: "amount" }, 7);
    });
    expect(summaryText(mounted.container)).toBe("Sum10");

    await act(async () => {
      runtimeInternalsFor(runtime!).cursorManager.clearCellRange(path);
    });
    expect(summaryBand(mounted.container)).toBeNull();

    await act(async () => {
      runtime!.root.drafts.add("draft", { amount: 4 });
    });
    const draftRowId = makeLevelRowId(path, "phantom", "draft");
    await act(async () => {
      runtimeInternalsFor(runtime!).cursorManager.setCellRange(
        path,
        { rowId: draftRowId, colId: "amount" },
        { rowId: draftRowId, colId: "amount" },
      );
    });
    expect(summaryText(mounted.container)).toBe("Sum4");

    await act(async () => {
      runtime!.root.drafts.setCell("draft", "amount", 6);
    });
    expect(summaryText(mounted.container)).toBe("Sum6");
  });

  it("exposes a stable live rectangle to composing components", async () => {
    runtime = createSummaryRuntime();
    const observed: (CellSelectionRectangle | null)[] = [];
    mounted = await render(rectangleProbe(runtime, observed, "initial"));

    await act(async () => {
      runtimeInternalsFor(runtime!).cursorManager.setCellRange(
        path,
        { rowId: firstRowId, colId: "amount" },
        { rowId: secondRowId, colId: "amount" },
      );
    });
    const selected = observed.at(-1);
    expect(selected?.rows.map((row) => row.columns.amount)).toEqual([2, 3]);

    await act(async () => {
      mounted?.root.render(rectangleProbe(runtime!, observed, "rerender"));
    });
    expect(observed.at(-1)).toBe(selected);

    await act(async () => {
      runtime!.root.writeCell({ rowId: firstRowId, colId: "amount" }, 7);
    });
    expect(observed.at(-1)).not.toBe(selected);
    expect(observed.at(-1)?.rows.map((row) => row.columns.amount)).toEqual([
      7, 3,
    ]);
  });
});

function rectangleProbe(
  runtime: ReturnType<typeof createSummaryRuntime>,
  observed: (CellSelectionRectangle | null)[],
  revision: string,
): ReactElement {
  return createElement(GridRuntimeProvider, {
    runtime,
    children: createElement(RectangleProbe, { observed, revision }),
  });
}

function RectangleProbe({
  observed,
}: {
  observed: (CellSelectionRectangle | null)[];
  revision: string;
}) {
  observed.push(useCellSelectionRectangle(path));
  return null;
}

function createSummaryRuntime() {
  return createGridRuntime({
    schema,
    phantomRows: {},
    dataSource: inMemoryGridDataSource({
      schema,
      tree: [
        { rowKey: "one", levelName: "rows", columns: { amount: 2 } },
        { rowKey: "two", levelName: "rows", columns: { amount: 3 } },
      ],
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

async function render(element: ReactElement): Promise<{
  root: Root;
  container: HTMLDivElement;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { root, container };
}

function summaryBand(container: HTMLElement): Element | null {
  return container.querySelector('[data-grid-part="selection-summary"]');
}

function summaryText(container: HTMLElement): string | null {
  return summaryBand(container)?.textContent?.replace(/\s/g, "") ?? null;
}
