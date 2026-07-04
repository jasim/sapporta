// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridDataSource, SortDescriptor } from "../../grid";
import { createGridRuntime, rootPath } from "../../grid";
import {
  hostBackedRowQuery,
  restLevelSource,
} from "../../grid/data-sources/rest/rest-level-source";
import { GridRuntimeProvider } from "../../grid/react/GridRuntimeProvider";
import type { TreeNode } from "../../grid/types/level-row";
import type { GridSchema } from "../../grid/types/schema";
import { columnPreset } from "../columns";
import { ColumnPresetHeader } from "./ColumnPresetHeader";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const rowsPath = rootPath("rows");

const schema: GridSchema = {
  rootLevel: "rows",
  levels: {
    rows: {
      name: "rows",
      columns: [
        columnPreset.text({
          id: "v",
          name: "Value",
        }),
      ],
      options: { rowKey: (node: TreeNode) => String(node.columns.id) },
      childLevels: [],
    },
  },
};

const nodes = (): TreeNode[] => [
  { levelName: "rows", columns: { id: "a", v: "Alpha" } },
  { levelName: "rows", columns: { id: "b", v: "Beta" } },
];

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function render(element: ReactElement): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe("ColumnPresetHeader sorting", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
  });

  it("cycles a host-owned sort through ascending, descending, and cleared chrome", async () => {
    let sort: SortDescriptor[] = [];
    const source = restLevelSource({
      fetchPage: vi.fn(async () => ({ nodes: nodes() })),
      rowQuery: hostBackedRowQuery({
        current: () => ({
          page: 0,
          pageSize: 50,
          sort,
        }),
        setSortState: (next) => {
          sort = next ? [...next] : [];
          return "changed";
        },
        setFilterState: () => "unchanged",
        setPageState: () => "unchanged",
      }),
      rowKey: (node) => String(node.columns.id),
    });
    const dataSource: GridDataSource = {
      rootSource: () => source,
      resolveChild: () => {
        throw new Error("not used");
      },
      dispose: () => {},
    };
    const runtime = createGridRuntime({ schema, dataSource });

    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(ColumnPresetHeader, {
          path: rowsPath,
          levelName: "rows",
          schema: schema.levels.rows.columns,
          options: {
            commandOverrides: () => ({
              setSort: (next) => source.query!.sort!.set(next),
            }),
          },
        }),
      }),
    );
    await act(async () => {
      await flush();
    });

    const header = mounted.container.querySelector(
      '[role="columnheader"][data-col-id="v"]',
    );
    if (!(header instanceof HTMLElement)) {
      throw new Error("expected Value header");
    }

    expect(header.getAttribute("aria-sort")).toBeNull();
    expect(
      header.querySelector('[data-grid-part="header-sort-indicator"]'),
    ).toBeNull();

    await act(async () => {
      header.click();
      await flush();
    });
    expect(sort).toEqual([{ colId: "v", direction: "asc" }]);
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(
      header.querySelector('[data-grid-part="header-sort-indicator"]'),
    ).toBeInstanceOf(HTMLElement);

    await act(async () => {
      header.click();
      await flush();
    });
    expect(sort).toEqual([{ colId: "v", direction: "desc" }]);
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(
      header.querySelector('[data-grid-part="header-sort-indicator"]'),
    ).toBeInstanceOf(HTMLElement);

    await act(async () => {
      header.click();
      await flush();
    });
    expect(sort).toEqual([]);
    expect(header.getAttribute("aria-sort")).toBeNull();
    expect(
      header.querySelector('[data-grid-part="header-sort-indicator"]'),
    ).toBeNull();
  });
});
