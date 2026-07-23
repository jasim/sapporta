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
import { CELL_GRID_WITH_ACTIVE_ROW, makeRowId, rootPath } from "@sapporta/grid";
import { controllerFor, cursorManagerFor } from "@sapporta/grid/advanced";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TableRowsClient } from "../grid-adapter/tgrid-level-config";
import { defineTGrid } from "../grid-adapter/tgrid-runtime-config";
import {
  useTGridActiveRow,
  useTGridSession,
} from "../grid-adapter/tgrid-binding";
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
  searchable: true,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", kind: "text", primary: true },
    { name: "name", label: "Name", kind: "text" },
  ],
  children: [],
};

const rowsClient: TableRowsClient = {
  fetch: vi.fn(async () => ({
    data: [
      { id: "cash", name: "Cash" },
      { id: "savings", name: "Savings" },
    ],
    meta: { total: 2, page: 1, limit: 50, pages: 1 },
  })),
  create: vi.fn(async (_table, data) => ({ data })),
  update: vi.fn(async (_table, _id, data) => ({ data })),
  remove: vi.fn(async (_table, id) => ({ data: { id } })),
};

const definition = defineTGrid<Rows>({
  rootLevel: "accounts",
  levels: {
    accounts: {
      table: accountsTable,
      rowHeaderColumn: "none",
      childLevels: [],
      rowsClient,
    },
  },
});

const activatingDefinition = defineTGrid<Rows>({
  ...definition,
  interaction: {
    ...CELL_GRID_WITH_ACTIVE_ROW,
    activeRow: {
      kind: "from-active-cell",
      activation: { startsOn: ["click"] },
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
  it("supports a nullable session during committed React creation", async () => {
    const states: string[] = [];

    function SessionProbe() {
      const session = useTGridSession(definition);
      const activeRow = useTGridActiveRow(session);
      const state = session
        ? activeRow === null
          ? "ready"
          : "active"
        : "loading";
      states.push(state);
      return createElement("output", null, state);
    }

    const container = document.createElement("div");
    document.body.append(container);
    const rootClient = createRoot(container);
    await act(async () => {
      rootClient.render(createElement(SessionProbe));
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    mounted = { root: rootClient, container };

    expect(states).toContain("loading");
    expect(container.textContent).toBe("ready");
  });

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

  it("adapts active-row state through the default cell-grid interaction", async () => {
    const session = createTGridSession(definition);
    sessions.push(session);
    const snapshots: Array<ReturnType<typeof session.activeRow>> = [];

    const container = document.createElement("div");
    document.body.append(container);
    const rootClient = createRoot(container);
    function ActiveRowName() {
      const active = useTGridActiveRow(session);
      snapshots.push(active);
      return createElement(
        "output",
        { "data-active-row": true },
        active?.kind === "data" ? active.values.name : "",
      );
    }
    await act(async () => {
      rootClient.render(
        createElement(
          "div",
          null,
          createElement(TGrid<Rows>, { session }),
          createElement(ActiveRowName),
        ),
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    mounted = { root: rootClient, container };
    expect(container.querySelector("[data-active-row]")?.textContent).toBe("");

    const path = rootPath("accounts");
    const cashRowId = makeRowId(path, "cash");
    await act(async () => {
      cursorManagerFor(session.runtime).moveCellCursorTo({
        path,
        rowId: cashRowId,
        colId: "name",
      });
    });
    expect(container.querySelector("[data-active-row]")?.textContent).toBe(
      "Cash",
    );
    const cashSnapshot = snapshots.at(-1);
    expect(cashSnapshot).toEqual(
      expect.objectContaining({
        kind: "data",
        levelId: "accounts",
        values: { id: "cash", name: "Cash" },
      }),
    );
    expect(session.activeRow()).toBe(cashSnapshot);

    await act(async () => {
      cursorManagerFor(session.runtime).moveCellCursorTo({
        path,
        rowId: makeRowId(path, "savings"),
        colId: "name",
      });
    });
    expect(container.querySelector("[data-active-row]")?.textContent).toBe(
      "Savings",
    );
    expect(snapshots.at(-1)).not.toBe(cashSnapshot);

    const savingsSnapshot = snapshots.at(-1);
    await act(async () => {
      session.runtime.root.writeCell(
        { rowId: makeRowId(path, "savings"), colId: "name" },
        "Reserve",
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-active-row]")?.textContent).toBe(
      "Reserve",
    );
    expect(snapshots.at(-1)).not.toBe(savingsSnapshot);
    expect(session.activeRow()).toBe(snapshots.at(-1));
  });

  it("forwards every row activation to the latest callback until unmount", async () => {
    const session = createTGridSession(activatingDefinition);
    sessions.push(session);
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const subscribe = vi.spyOn(session, "onRowActivate");

    const container = document.createElement("div");
    document.body.append(container);
    const rootClient = createRoot(container);
    await act(async () => {
      rootClient.render(
        createElement(TGrid<Rows>, {
          session,
          onRowActivate: firstCallback,
        }),
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    mounted = { root: rootClient, container };

    const path = rootPath("accounts");
    const rowId = makeRowId(path, "cash");
    await act(async () => {
      cursorManagerFor(session.runtime).moveCellCursorTo({
        path,
        rowId,
        colId: "name",
      });
    });
    expect(firstCallback).not.toHaveBeenCalled();

    await act(async () => {
      rootClient.render(
        createElement(TGrid<Rows>, {
          session,
          onRowActivate: latestCallback,
        }),
      );
    });
    expect(subscribe).toHaveBeenCalledTimes(1);

    const activate = () =>
      controllerFor(session.runtime, path).handleCellPointer(
        { rowId, colId: "name" },
        {
          gesture: "click",
          button: 0,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
      );
    let firstHandled = false;
    let secondHandled = false;
    await act(async () => {
      firstHandled = activate();
      secondHandled = activate();
    });
    expect(firstHandled).toBe(true);
    expect(secondHandled).toBe(true);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(2);
    expect(latestCallback).toHaveBeenLastCalledWith({
      activeRow: expect.objectContaining({
        kind: "data",
        levelId: "accounts",
        values: { id: "cash", name: "Cash" },
      }),
      trigger: { kind: "pointer", gesture: "click" },
    });

    await act(async () => {
      rootClient.unmount();
    });
    container.remove();
    mounted = null;
    activate();
    expect(latestCallback).toHaveBeenCalledTimes(2);
  });
});
