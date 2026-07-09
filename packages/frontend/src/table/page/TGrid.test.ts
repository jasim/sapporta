// @vitest-environment happy-dom

import {
  act,
  cloneElement,
  createElement,
  isValidElement,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CELL_GRID_WITH_ACTIVE_ROW,
  createGridRuntime,
  inMemoryGridDataSource,
  type ColId,
  type ColumnSchema,
  type GridRuntime,
  type GridSchema,
  type TreeNode,
} from "@sapporta/grid";
import type { TGridSession } from "../state/tgrid-session";
import { TGrid } from "./TGrid";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@sapporta/ui/context-menu", async () => {
  const { createElement: h } =
    await vi.importActual<typeof import("react")>("react");

  return {
    ContextMenu: ({ children }: { children: ReactNode }) =>
      h("div", null, children),
    ContextMenuTrigger: ({
      children,
      onContextMenuCapture,
      render,
    }: {
      children: ReactNode;
      onContextMenuCapture?: MouseEventHandler<HTMLDivElement>;
      render?: ReactElement<HTMLAttributes<HTMLDivElement>>;
    }) =>
      isValidElement(render)
        ? cloneElement(render, { onContextMenuCapture }, children)
        : h("div", { onContextMenuCapture }, children),
    ContextMenuContent: ({ children }: { children: ReactNode }) =>
      h("div", null, children),
    ContextMenuItem: ({ children }: { children: ReactNode }) =>
      h("button", { type: "button" }, children),
  };
});

type Rows = {
  accounts: { id: string; name: string };
};

const schema: GridSchema = {
  rootLevel: "accounts",
  levels: {
    accounts: {
      name: "accounts",
      columns: [column("name", "Name")],
      options: { rowKey: (node, localIdx) => node.rowKey ?? String(localIdx) },
      childLevels: [],
    },
  },
};

const tree: TreeNode[] = [
  {
    rowKey: "cash",
    levelName: "accounts",
    columns: { id: "cash", name: "Cash" },
  },
];

let mounted: { root: Root; container: HTMLElement } | null = null;
const runtimes: GridRuntime[] = [];

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose();
  }
});

describe("TGrid", () => {
  it("wraps the grid level with the copy context menu scope", async () => {
    const runtime = makeRuntime();
    const session = {
      rootLevel: "accounts",
      runtime,
      levels: {},
      levelInfoById: {},
      appServices: undefined,
      lookups: {},
      setLevelSort: vi.fn(),
      setLevelFilter: vi.fn(),
    } as unknown as TGridSession<Rows>;

    const container = document.createElement("div");
    document.body.append(container);
    const rootClient = createRoot(container);
    await act(async () => {
      rootClient.render(createElement(TGrid<Rows>, { session }));
    });
    mounted = { root: rootClient, container };

    expect(
      container.querySelector('[data-grid-copy-menu-scope="true"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(
      container.querySelector(".sapporta-table-grid--editable"),
    ).toBeInstanceOf(HTMLElement);
    expect(container.textContent).toContain("Cash");
  });
});

function makeRuntime(): GridRuntime {
  const runtime = createGridRuntime({
    schema,
    dataSource: inMemoryGridDataSource({
      schema,
      tree,
      levels: {
        accounts: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
    interaction: CELL_GRID_WITH_ACTIVE_ROW,
  });
  runtimes.push(runtime);
  return runtime;
}

function column(id: ColId, name: string): ColumnSchema {
  return {
    id,
    name,
    renderCell: ({ value }) => String(value ?? ""),
  };
}
