// @vitest-environment happy-dom

import {
  act,
  cloneElement,
  createElement,
  isValidElement,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRowId, rootPath } from "@sapporta/grid";
import type { PaginatedRows, TableSchema } from "@sapporta/shared/contracts";
import type { FetchTableRowsParams } from "../api/rows";
import type { TableRowsClient } from "./tgrid-level-config";
import { defineTGrid } from "./tgrid-runtime-config";
import { createTGridSession, type TGridSession } from "./tgrid-session";
import { TGrid } from "./TGrid";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The menu primitives render inline, forward the trigger's right-click, and
// forward item clicks, so a test can open the menu and choose an item.
vi.mock("@sapporta/ui/context-menu", async () => {
  const { createElement: h } =
    await vi.importActual<typeof import("react")>("react");
  type TriggerProps = {
    children: ReactNode;
    onContextMenu?: (
      event: MouseEvent & { preventBaseUIHandler: () => void },
    ) => void;
    render?: ReactElement<HTMLAttributes<HTMLDivElement>>;
  };
  return {
    ContextMenu: ({ children }: { children: ReactNode }) =>
      h("div", null, children),
    ContextMenuTrigger: ({ children, onContextMenu, render }: TriggerProps) => {
      const handler = (event: MouseEvent) =>
        onContextMenu?.(Object.assign(event, { preventBaseUIHandler() {} }));
      return isValidElement(render)
        ? cloneElement(render, { onContextMenu: handler }, children)
        : h("div", { onContextMenu: handler }, children);
    },
    ContextMenuContent: ({ children }: { children: ReactNode }) =>
      h("div", { "data-menu": true }, children),
    ContextMenuItem: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: () => void;
    }) => h("button", { type: "button", onClick }, children),
    ContextMenuSeparator: () => h("hr"),
  };
});

type AccountRow = { id: number; name: string; parent_id: number | null };
type Rows = { accounts: AccountRow };

const accountsTable: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", kind: "number", primary: true },
    { name: "name", label: "Name", kind: "text" },
    { name: "parent_id", label: "Parent", kind: "number" },
  ],
  children: [],
  tree: {
    parentColumn: "parent_id",
    column: "name",
    defaultExpanded: true,
    matchContext: "ancestors-and-descendants",
  },
};

// Expenses(4) > Taxes(5) > Federal(6); Income(7). Children come first to
// show that the grid, not the source order, places them under parents.
const allRows: AccountRow[] = [
  { id: 6, name: "Federal", parent_id: 5 },
  { id: 4, name: "Expenses", parent_id: null },
  { id: 5, name: "Taxes", parent_id: 4 },
  { id: 7, name: "Income", parent_id: null },
];

function page(
  data: AccountRow[],
  tree?: PaginatedRows["meta"]["tree"],
): PaginatedRows {
  return {
    data,
    meta: {
      total: data.length,
      page: 1,
      limit: 1000,
      pages: 1,
      ...(tree ? { tree } : {}),
    },
  };
}

function rowsClient(): TableRowsClient & {
  fetch: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  return {
    fetch: vi.fn(async (params: FetchTableRowsParams) =>
      params.search === "federal"
        ? page(allRows.slice(0, 3), { matchCount: 1, contextIds: ["4", "5"] })
        : page(allRows),
    ),
    create: vi.fn(async (_table: string, data: Record<string, unknown>) => ({
      data: { id: 8, ...data },
    })),
    update: vi.fn(async (_table, _id, data) => ({ data })),
    remove: vi.fn(async (_table, id) => ({ data: { id } })),
  };
}

let mounted: { root: Root; container: HTMLElement } | null = null;
const sessions: TGridSession<Rows>[] = [];

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  for (const session of sessions.splice(0)) session.dispose();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

async function renderTree(client: TableRowsClient) {
  const session = createTGridSession(
    defineTGrid<Rows>({
      rootLevel: "accounts",
      levels: {
        accounts: { table: accountsTable, childLevels: [], rowsClient: client },
      },
    }),
  );
  sessions.push(session);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(TGrid<Rows>, { session, presentation: "tabular" }),
    );
    await flush();
  });
  mounted = { root, container };
  return { session, container };
}

const path = rootPath("accounts");
const id = (key: number) => makeRowId(path, String(key));

function rowNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-grid-part="row"]')).map(
    (row) =>
      row.querySelector('[data-col-id="name"]')?.textContent?.trim() ?? "",
  );
}

describe("TGrid tree tables", () => {
  it("shows the table as one tree under one header", async () => {
    const { container } = await renderTree(rowsClient());
    expect(rowNames(container)).toEqual([
      "Expenses",
      "Taxes",
      "Federal",
      "Income",
    ]);
    expect(
      container.querySelectorAll('[data-grid-part="header-row"]'),
    ).toHaveLength(1);
    expect(container.querySelector('[role="treegrid"]')).not.toBeNull();
    const federal = container.querySelector(`[data-row-id="${id(6)}"]`);
    expect(federal?.getAttribute("aria-level")).toBe("3");
    const income = container.querySelector(`[data-row-id="${id(7)}"]`);
    expect(income?.querySelector('[data-grid-part="tree-chevron"]')).toBeNull();
  });

  it("shows a deep search match under its ancestors", async () => {
    const client = rowsClient();
    const { session, container } = await renderTree(client);
    await act(async () => {
      session.queryStore.getState().setSearch("federal");
      await flush();
    });
    expect(client.fetch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "federal",
        page: 1,
        limit: 1000,
        tree: "ancestors-and-descendants",
      }),
    );
    expect(rowNames(container)).toEqual(["Expenses", "Taxes", "Federal"]);
    const contexts = Array.from(
      container.querySelectorAll('[data-tree-context="true"]'),
    ).map((row) => row.getAttribute("data-row-id"));
    expect(contexts).toEqual([id(4), id(5)]);
    expect(session.queryStore.getState().treeResult).toEqual({
      matchCount: 1,
      loadedRowCount: 3,
      truncated: false,
    });
  });

  it("adds a child row from the row's context menu", async () => {
    const client = rowsClient();
    const { session, container } = await renderTree(client);
    const incomeCell = container.querySelector(
      `[data-row-id="${id(7)}"] [data-col-id="name"]`,
    );
    if (!(incomeCell instanceof HTMLElement)) throw new Error("no cell");
    await act(async () => {
      incomeCell.dispatchEvent(
        new window.MouseEvent("contextmenu", { bubbles: true }),
      );
    });
    const addChild = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add child row",
    );
    if (!addChild) throw new Error("no Add child row item");
    await act(async () => {
      addChild.click();
      await flush();
    });

    const draft = session.runtime.root.drafts.get()[0];
    expect(draft?.columns).toEqual({ parent_id: 7 });
    const draftId = session.runtime.root.displayedRows().rows.at(-1)?.id;
    expect(draftId && session.runtime.root.tree?.parentOf(draftId)).toBe(id(7));

    await act(async () => {
      session.runtime.root.drafts.setCell(draft!.rowKey, "name", "Salary");
      await session.runtime.root.drafts.commit(draft!.rowKey);
      await flush();
    });
    expect(client.create).toHaveBeenCalledWith("accounts", {
      name: "Salary",
      parent_id: 7,
    });
    expect(session.runtime.root.tree?.childrenOf(id(7))).toEqual([id(8)]);
  });
});

describe("showing one row of a tree table", () => {
  // The server's rows, which a test may add to, as a search returns them:
  // each match with the branches above it.
  function liveRowsClient(rows: AccountRow[]) {
    const client = rowsClient();
    client.fetch.mockImplementation(async (params: FetchTableRowsParams) => {
      if (!params.search) return page([...rows]);
      const kept = new Set<number>();
      for (const match of rows.filter((row) =>
        row.name.toLowerCase().includes(String(params.search)),
      )) {
        let at: AccountRow | undefined = match;
        while (at) {
          kept.add(at.id);
          at = rows.find((row) => row.id === at?.parent_id);
        }
      }
      return page(rows.filter((row) => kept.has(row.id)));
    });
    return client;
  }

  async function mountTree(rows: AccountRow[]) {
    const client = liveRowsClient(rows);
    const onQueryUrlChange = vi.fn();
    const session = createTGridSession(
      defineTGrid<Rows>({
        rootLevel: "accounts",
        levels: {
          accounts: {
            table: accountsTable,
            childLevels: [],
            rowsClient: client,
          },
        },
      }),
      { onQueryUrlChange },
    );
    sessions.push(session);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(TGrid<Rows>, { session, presentation: "tabular" }),
      );
      await flush();
    });
    mounted = { root, container };
    return { session, container, client, onQueryUrlChange };
  }

  async function show(
    session: TGridSession<Rows>,
    rowKey: string,
    options?: { clearQueryIfHidden?: boolean },
  ) {
    let result: string | undefined;
    await act(async () => {
      result = await session.showRow(rowKey, options);
      await flush();
    });
    return result;
  }

  it("opens the branches above a loaded row and puts the cursor on it", async () => {
    const { session, container, client } = await mountTree([...allRows]);
    await act(async () => session.runtime.root.tree?.collapseAll());
    expect(rowNames(container)).toEqual(["Expenses", "Income"]);
    const reads = client.fetch.mock.calls.length;

    expect(await show(session, "6")).toBe("shown");

    expect(rowNames(container)).toEqual([
      "Expenses",
      "Taxes",
      "Federal",
      "Income",
    ]);
    expect(session.activeRow()?.id).toBe(id(6));
    expect(client.fetch.mock.calls.length).toBe(reads);
  });

  it("reads the rows again for a row saved after they loaded", async () => {
    const rows = [...allRows];
    const { session, client } = await mountTree(rows);
    const reads = client.fetch.mock.calls.length;
    rows.push({ id: 8, name: "Salary", parent_id: 7 });

    expect(await show(session, "8")).toBe("shown");

    expect(session.activeRow()?.id).toBe(id(8));
    expect(client.fetch.mock.calls.length).toBe(reads + 1);
  });

  it("waits for a read already under way instead of starting another", async () => {
    const rows = [...allRows];
    const { session, client } = await mountTree(rows);
    const reads = client.fetch.mock.calls.length;
    rows.push({ id: 8, name: "Salary", parent_id: 7 });

    let result: string | undefined;
    await act(async () => {
      void session.reloadRows();
      result = await session.showRow("8");
      await flush();
    });

    expect(result).toBe("shown");
    expect(client.fetch.mock.calls.length).toBe(reads + 1);
  });

  it("clears a search that leaves the row out, and the URL follows", async () => {
    const rows = [...allRows];
    const { session, container, onQueryUrlChange } = await mountTree(rows);
    await act(async () => {
      session.queryStore.getState().setSearch("federal");
      await flush();
    });
    rows.push({ id: 8, name: "Salary", parent_id: 7 });

    expect(await show(session, "8", { clearQueryIfHidden: true })).toBe(
      "shown",
    );

    expect(session.queryStore.getState().search).toBeNull();
    expect(onQueryUrlChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: null, filters: [] }),
    );
    expect(rowNames(container)).toContain("Salary");
    expect(session.activeRow()?.id).toBe(id(8));
  });

  it("keeps the search unless asked to clear it", async () => {
    const rows = [...allRows];
    const { session } = await mountTree(rows);
    await act(async () => {
      session.queryStore.getState().setSearch("federal");
      await flush();
    });
    rows.push({ id: 8, name: "Salary", parent_id: 7 });

    expect(await show(session, "8")).toBe("not-found");

    expect(session.queryStore.getState().search).toBe("federal");
    expect(session.activeRow()).toBeNull();
  });

  it("puts the search back when clearing it does not bring the row", async () => {
    const { session, onQueryUrlChange } = await mountTree([...allRows]);
    await act(async () => {
      session.queryStore.getState().setSearch("federal");
      await flush();
    });

    expect(await show(session, "99", { clearQueryIfHidden: true })).toBe(
      "not-found",
    );

    expect(session.queryStore.getState().search).toBe("federal");
    expect(onQueryUrlChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "federal" }),
    );
  });

  it("finds nothing once the session is disposed", async () => {
    const { session } = await mountTree([...allRows]);
    session.dispose();
    expect(await session.showRow("6")).toBe("not-found");
  });
});
