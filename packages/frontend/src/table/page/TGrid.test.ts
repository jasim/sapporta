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
import { CELL_GRID_WITH_ACTIVE_ROW } from "@sapporta/grid";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TableRowsClient } from "../grid-adapter/tgrid-level-config";
import { defineTGrid } from "../grid-adapter/tgrid-runtime-config";
import { createTGridSession, type TGridSession } from "../state/tgrid-session";
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

const accountsTable: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", kind: "text", primary: true },
    { name: "name", label: "Name", kind: "text" },
  ],
  children: [],
};

const rowsClient: TableRowsClient = {
  fetch: vi.fn(async () => ({
    data: [{ id: "cash", name: "Cash" }],
    meta: { total: 1, page: 1, limit: 50, pages: 1 },
  })),
  create: vi.fn(async (_table, data) => ({ data })),
  update: vi.fn(async (_table, _id, data) => ({ data })),
  remove: vi.fn(async (_table, id) => ({ data: { id } })),
};

const definition = defineTGrid<Rows>({
  rootLevel: "accounts",
  interaction: CELL_GRID_WITH_ACTIVE_ROW,
  levels: {
    accounts: {
      table: accountsTable,
      rowHeaderColumn: "none",
      childLevels: [],
      rowsClient,
    },
  },
});

let mounted: { root: Root; container: HTMLElement } | null = null;
const sessions: TGridSession<Rows>[] = [];

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
});

describe("TGrid", () => {
  it("wraps the grid level with the copy context menu scope", async () => {
    const session = createTGridSession(definition);
    sessions.push(session);

    const container = document.createElement("div");
    document.body.append(container);
    const rootClient = createRoot(container);
    await act(async () => {
      rootClient.render(createElement(TGrid<Rows>, { session }));
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
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
