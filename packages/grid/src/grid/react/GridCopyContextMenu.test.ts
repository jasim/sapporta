// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
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
import { GridCopyContextMenu } from "./GridCopyContextMenu";
import { GridRuntimeProvider } from "./GridRuntimeProvider";
import {
  createGridRuntime,
  runtimeInternalsFor,
  type GridRuntime,
} from "../runtime/create-grid-runtime";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import { rootPath } from "../types/identity";
import { makeRowId, type ColId, type RowId } from "../types/identity";
import type { ColumnSchema, GridSchema } from "../types/schema";
import type { TreeNode } from "../types/level-row";
import { CELL_GRID_WITH_ACTIVE_ROW } from "../types/interaction";
import {
  gridCellIdentityAttrs,
  gridRootIdentityAttrs,
  gridRowIdentityAttrs,
} from "./internal/dom-targets";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@sapporta/ui/context-menu", async () => {
  const { createElement: h } =
    await vi.importActual<typeof import("react")>("react");

  return {
    ContextMenu: ({ children }: { children: ReactNode }) =>
      h("div", { "data-testid": "context-menu" }, children),
    ContextMenuTrigger: ({
      children,
      onContextMenuCapture,
      render,
    }: {
      children: ReactNode;
      onContextMenuCapture?: MouseEventHandler<HTMLDivElement>;
      render?: ReactElement<
        HTMLAttributes<HTMLDivElement> & { "data-testid"?: string }
      >;
    }) =>
      isValidElement(render)
        ? cloneElement(
            render,
            {
              "data-testid": "context-menu-trigger",
              onContextMenuCapture,
            },
            children,
          )
        : h(
            "div",
            {
              "data-testid": "context-menu-trigger",
              onContextMenuCapture,
            },
            children,
          ),
    ContextMenuContent: ({ children }: { children: ReactNode }) =>
      h("div", { "data-testid": "context-menu-content" }, children),
    ContextMenuItem: ({
      children,
      disabled,
      onClick,
    }: {
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) =>
      h(
        "button",
        {
          disabled,
          onClick: () => onClick?.(),
          type: "button",
        },
        children,
      ),
  };
});

const root = rootPath("accounts");
const cashId = makeRowId(root, "cash");
const revenueId = makeRowId(root, "revenue");

const schema: GridSchema = {
  rootLevel: "accounts",
  levels: {
    accounts: {
      name: "accounts",
      rowHeaderColumn: "none",
      columns: [column("account", "Account"), column("debit", "Debit")],
      options: {},
      childLevels: [],
    },
  },
};

const tree: TreeNode[] = [
  {
    rowKey: "cash",
    levelName: "accounts",
    columns: { account: "Cash", debit: 125 },
  },
  {
    rowKey: "revenue",
    levelName: "accounts",
    columns: { account: "Revenue", debit: 0 },
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

describe("GridCopyContextMenu", () => {
  it("copies a right-clicked cell", async () => {
    const writeText = installClipboardMock();
    const runtime = makeRuntime();
    const container = await renderWithRuntime(
      runtime,
      renderGridCell(cashId, "account", "Cash"),
    );

    await contextMenu(container.querySelector("span"));
    await clickButton(container, "Copy");

    expect(writeText).toHaveBeenCalledWith("Cash");
  });

  it("copies the selected range with headers", async () => {
    const writeText = installClipboardMock();
    const runtime = makeRuntime();
    runtimeInternalsFor(runtime).cursorManager.setCellRange(
      root,
      { rowId: cashId, colId: "account" },
      { rowId: revenueId, colId: "debit" },
    );
    const container = await renderWithRuntime(
      runtime,
      renderGridCell(cashId, "account", "Cash"),
    );

    await contextMenu(container.querySelector("span"));
    await clickButton(container, "Copy with headers");

    expect(writeText).toHaveBeenCalledWith(
      "account,debit\nCash,125\nRevenue,0",
    );
  });

  it("disables copy commands when no target is available", async () => {
    const runtime = makeRuntime();
    const container = await renderWithRuntime(
      runtime,
      createElement("div", null, "empty surface"),
    );

    await contextMenu(container.querySelector("[data-grid-copy-menu-scope]"));

    expect(button(container, "Copy").disabled).toBe(true);
    expect(button(container, "Copy with headers").disabled).toBe(true);
  });
});

async function renderWithRuntime(
  runtime: GridRuntime,
  child: ReactElement,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const rootClient = createRoot(container);
  await act(async () => {
    rootClient.render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridCopyContextMenu, { children: child }),
      }),
    );
  });
  mounted = { root: rootClient, container };
  return container;
}

async function contextMenu(target: Element | null): Promise<void> {
  if (!target) throw new Error("Expected context menu target");
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, button: 2 }),
    );
  });
}

async function clickButton(
  container: HTMLElement,
  text: string,
): Promise<void> {
  const item = button(container, text);
  await act(async () => {
    item.click();
    await Promise.resolve();
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const item = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(item instanceof HTMLButtonElement)) {
    throw new Error(`Expected button "${text}"`);
  }
  return item;
}

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

function renderGridCell(
  rowId: RowId,
  colId: ColId,
  text: string,
): ReactElement {
  return createElement(
    "div",
    gridRootIdentityAttrs(root),
    createElement(
      "div",
      gridRowIdentityAttrs(rowId),
      createElement(
        "div",
        gridCellIdentityAttrs(colId),
        createElement("span", null, text),
      ),
    ),
  );
}

function column(id: ColId, name: string): ColumnSchema {
  return {
    id,
    name,
    renderCell: ({ value }) => String(value ?? ""),
  };
}

function installClipboardMock(): (text: string) => Promise<void> {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}
