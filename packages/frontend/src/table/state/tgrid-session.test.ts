// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  eqCondition,
  parseFiltersForTable,
  type FilterCondition,
} from "@sapporta/shared/filter";
import {
  makeRowId,
  rootPath,
  ROW_PRIMARY_MASTER_DETAIL_WITH_ACTIVATION,
} from "@sapporta/grid";
import { controllerFor, cursorManagerFor } from "@sapporta/grid/advanced";
import {
  createTGridSession,
  type TGridLoadedRowsBoundaryHandler,
} from "./tgrid-session";
import { defineTGrid } from "../grid-adapter/tgrid-runtime-config";
import type { TableRowsClient } from "../grid-adapter/tgrid-level-config";

vi.mock("../api/rows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/rows")>();
  return {
    ...actual,
    fetchTableRows: vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 1, limit: 50, pages: 0 },
    })),
  };
});

type OrderRow = {
  id: number;
  customer: string;
  status: string;
};

type RowsByLevel = {
  orders: OrderRow;
};

const ordersTable: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["customer"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "customer", label: "Customer", kind: "text" },
    { name: "status", label: "Status", kind: "text" },
  ],
  children: [],
};

function typedFilters(filters: readonly FilterCondition[]) {
  return parseFiltersForTable(filters, ordersTable);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const paginateLoadedRowsForTest: TGridLoadedRowsBoundaryHandler<RowsByLevel> = (
  event,
  levelId,
  session,
) => {
  const query = session.getQueryState(levelId);
  const nextPage =
    event.direction === "after" ? query.page + 1 : query.page - 1;
  if (nextPage < 1) return false;
  if (
    event.direction === "after" &&
    query.totalCount !== null &&
    query.page * query.pageSize >= query.totalCount
  ) {
    return false;
  }
  return session.setLevelPage(
    levelId,
    event.loadPath,
    nextPage,
    query.pageSize,
  );
};

describe("TGridSession", () => {
  it("exposes typed active-row state and delegates the row Enter command", async () => {
    const rowsClient: TableRowsClient = {
      fetch: vi.fn(async () => ({
        data: [
          { id: 1, customer: "Acme", status: "open" },
          { id: 2, customer: "Beta", status: "open" },
        ],
        meta: { total: 2, page: 1, limit: 50, pages: 1 },
      })),
      create: vi.fn(async (_table, data) => ({ data })),
      update: vi.fn(async (_table, _id, data) => ({ data })),
      remove: vi.fn(async (_table, id) => ({ data: { id } })),
    };
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      interaction: ROW_PRIMARY_MASTER_DETAIL_WITH_ACTIVATION,
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: { owner: "host" },
          rowsClient,
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition);

    try {
      await flush();
      const path = rootPath("orders");
      const firstRowId = makeRowId(path, "1");
      const activeRowChanged = vi.fn();
      const onRowActivate = vi.fn();
      session.subscribeActiveRow(activeRowChanged);
      session.onRowActivate(onRowActivate);
      cursorManagerFor(session.runtime).moveRowCursorTo({
        path,
        rowId: firstRowId,
      });

      expect(session.activeRow()).toEqual(
        expect.objectContaining({
          kind: "data",
          id: firstRowId,
          levelId: "orders",
          values: { id: 1, customer: "Acme", status: "open" },
          level: expect.objectContaining({ path }),
          runtime: session.runtime,
        }),
      );
      expect(activeRowChanged).toHaveBeenCalledTimes(1);

      const controller = controllerFor(session.runtime, path);
      expect(controller.handleKey(keyEvent("Enter"))).toBe(true);
      expect(onRowActivate).toHaveBeenCalledWith({
        activeRow: expect.objectContaining({
          kind: "data",
          id: firstRowId,
          levelId: "orders",
          values: { id: 1, customer: "Acme", status: "open" },
        }),
        trigger: { kind: "keyboard", gesture: "enter" },
      });

      cursorManagerFor(session.runtime).clearRowCursor();
      expect(session.activeRow()).toBe(null);
      expect(activeRowChanged).toHaveBeenCalledTimes(2);
    } finally {
      session.dispose();
    }
  });

  it("uses level initial filters when no route query seed is provided", () => {
    const initialFilter = eqCondition("status", "open");
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: {
            owner: "host",
            initialFilters: [initialFilter],
            initialSearch: "acme",
            initialPage: 2,
          },
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition);

    try {
      expect(session.getQueryState()).toMatchObject({
        filters: [
          expect.objectContaining({
            column: "status",
            op: "eq",
            kind: "text",
            value: "open",
          }),
        ],
        search: "acme",
        page: 2,
      });
    } finally {
      session.dispose();
    }
  });

  it("uses typed route filters from the URL boundary", () => {
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: { owner: "host" },
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition, {
      routeQuerySeeds: {
        orders: {
          filters: typedFilters([eqCondition("id", "7")]),
        },
      },
    });

    try {
      expect(session.getQueryState().filters).toEqual([
        expect.objectContaining({
          column: "id",
          op: "eq",
          kind: "number",
          value: 7,
        }),
      ]);
    } finally {
      session.dispose();
    }
  });

  it("lets an explicit empty route sort override initial sort", () => {
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: {
            owner: "host",
            initialSort: [{ colId: "customer", direction: "asc" }],
          },
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition, {
      routeQuerySeeds: {
        orders: {
          sort: [],
        },
      },
    });

    try {
      expect(session.getQueryState().sort).toEqual([]);
      const url = new URL(session.csvExportUrl(), "http://localhost");
      expect(url.searchParams.has("sort")).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it("exports the current cleared search instead of falling back to initial search", () => {
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: {
            owner: "host",
            initialSearch: "acme",
          },
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition, {
      routeQuerySeeds: {
        orders: {
          search: null,
        },
      },
    });

    try {
      expect(session.getQueryState().search).toBeNull();
      const url = new URL(session.csvExportUrl(), "http://localhost");
      expect(url.searchParams.has("q")).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it("restores configured defaults when URL sync has no query values", () => {
    const initialFilter = eqCondition("status", "open");
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: {
            owner: "host",
            initialFilters: [initialFilter],
            initialSearch: "acme",
            initialPage: 2,
            initialSort: [{ colId: "customer", direction: "asc" }],
          },
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition, {
      routeQuerySeeds: {
        orders: {
          page: 4,
          filters: typedFilters([eqCondition("customer", "ACME")]),
          search: null,
          sort: [],
        },
      },
    });

    try {
      session.queryStore.getState().syncFromUrl({});
      expect(session.getQueryState()).toMatchObject({
        page: 2,
        filters: [
          expect.objectContaining({
            column: "status",
            op: "eq",
            kind: "text",
            value: "open",
          }),
        ],
        search: "acme",
        sort: [{ colId: "customer", direction: "asc" }],
      });
    } finally {
      session.dispose();
    }
  });

  it("includes fixed query filters in CSV export links", () => {
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: {
            owner: "host",
            fixedFilters: [eqCondition("status", "open")],
          },
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition, {
      routeQuerySeeds: {
        orders: {
          filters: typedFilters([eqCondition("customer", "ACME")]),
        },
      },
    });

    try {
      const url = new URL(session.csvExportUrl(), "http://localhost");
      expect(url.pathname).toBe("/api/tables/orders/export.csv");
      expect(url.searchParams.get("filter[status][eq]")).toBe("open");
      expect(url.searchParams.get("filter[customer][eq]")).toBe("ACME");
      expect(url.searchParams.has("page")).toBe(false);
      expect(url.searchParams.has("limit")).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it("uses the query-store page path for keyboard page-boundary navigation", async () => {
    const rowsClient: TableRowsClient = {
      fetch: vi.fn(async ({ page }) => ({
        data:
          page === 1
            ? [{ id: 1, customer: "Acme", status: "open" }]
            : [{ id: 2, customer: "Beta", status: "open" }],
        meta: { total: 2, page, limit: 1, pages: 2 },
      })),
      create: vi.fn(async (_table, data) => ({ data })),
      update: vi.fn(async (_table, _id, data) => ({ data })),
      remove: vi.fn(async (_table, id) => ({ data: { id } })),
    };
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: { owner: "host", pageSize: 1 },
          rowsClient,
        },
      },
    });
    const onQueryUrlChange = vi.fn();
    const onLoadedRowsBoundary = vi.fn<
      TGridLoadedRowsBoundaryHandler<RowsByLevel>
    >((event, levelId, session) => {
      const query = session.getQueryState(levelId);
      return session.setLevelPage(
        levelId,
        event.loadPath,
        query.page + 1,
        query.pageSize,
      );
    });
    const session = createTGridSession<RowsByLevel>(definition, {
      onQueryUrlChange,
      onLoadedRowsBoundary,
    });

    try {
      await flush();
      const path = rootPath("orders");
      const cursors = cursorManagerFor(session.runtime);
      const controller = controllerFor(session.runtime, path);
      cursors.moveCellCursorTo({
        path,
        rowId: makeRowId(path, "1"),
        colId: "customer",
      });

      controller.handleKey(keyEvent("ArrowDown"));
      await flush();

      expect(session.getQueryState().page).toBe(2);
      expect(onQueryUrlChange).toHaveBeenCalledWith({
        level: "orders",
        page: 2,
        sort: [],
        filters: [],
        search: null,
      });
      expect(cursors.currentCellCursor()).toEqual({
        path,
        rowId: makeRowId(path, "2"),
        colId: "customer",
      });
      expect(onLoadedRowsBoundary).toHaveBeenCalledTimes(1);
      expect(onLoadedRowsBoundary.mock.calls[0]?.[0]).toMatchObject({
        kind: "cell",
        loadPath: path,
        direction: "after",
        origin: {
          path,
          rowId: makeRowId(path, "1"),
          colId: "customer",
        },
      });
      expect(onLoadedRowsBoundary.mock.calls[0]?.[1]).toBe("orders");
      expect(onLoadedRowsBoundary.mock.calls[0]?.[2]).toBe(session);
    } finally {
      session.dispose();
    }
  });

  it("leaves a loaded-row boundary unhandled when no parent policy is installed", async () => {
    const rowsClient: TableRowsClient = {
      fetch: vi.fn(async ({ page }) => ({
        data: [{ id: page, customer: "Acme", status: "open" }],
        meta: { total: 2, page, limit: 1, pages: 2 },
      })),
      create: vi.fn(async (_table, data) => ({ data })),
      update: vi.fn(async (_table, _id, data) => ({ data })),
      remove: vi.fn(async (_table, id) => ({ data: { id } })),
    };
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: { owner: "host", pageSize: 1 },
          rowsClient,
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition);

    try {
      await flush();
      const path = rootPath("orders");
      const cursors = cursorManagerFor(session.runtime);
      cursors.moveCellCursorTo({
        path,
        rowId: makeRowId(path, "1"),
        colId: "customer",
      });

      controllerFor(session.runtime, path).handleKey(keyEvent("ArrowDown"));
      await flush();

      expect(session.getQueryState().page).toBe(1);
      expect(rowsClient.fetch).toHaveBeenCalledTimes(1);
      expect(cursors.currentCellCursor()).toEqual({
        path,
        rowId: makeRowId(path, "1"),
        colId: "customer",
      });
    } finally {
      session.dispose();
    }
  });

  it("does not request page zero when page-boundary navigation cannot go previous", async () => {
    const fetch = vi.fn<TableRowsClient["fetch"]>(async ({ page }) => {
      const pageNumber = page ?? 1;
      return {
        data: [
          {
            id: pageNumber,
            customer: `Customer ${pageNumber}`,
            status: "open",
          },
        ],
        meta: { total: 2, page: pageNumber, limit: 1, pages: 2 },
      };
    });
    const rowsClient: TableRowsClient = {
      fetch,
      create: vi.fn(async (_table, data) => ({ data })),
      update: vi.fn(async (_table, _id, data) => ({ data })),
      remove: vi.fn(async (_table, id) => ({ data: { id } })),
    };
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: { owner: "host", pageSize: 1 },
          rowsClient,
        },
      },
    });
    const onQueryUrlChange = vi.fn();
    const session = createTGridSession<RowsByLevel>(definition, {
      onQueryUrlChange,
      onLoadedRowsBoundary: paginateLoadedRowsForTest,
    });

    try {
      await flush();
      const path = rootPath("orders");
      const cursors = cursorManagerFor(session.runtime);
      const controller = controllerFor(session.runtime, path);
      cursors.moveCellCursorTo({
        path,
        rowId: makeRowId(path, "1"),
        colId: "customer",
      });

      controller.handleKey(keyEvent("ArrowUp"));
      await flush();

      expect(fetch.mock.calls.map(([req]) => req.page)).toEqual([1]);
      expect(session.getQueryState().page).toBe(1);
      expect(onQueryUrlChange).not.toHaveBeenCalled();
      expect(cursors.currentCellCursor()).toEqual({
        path,
        rowId: makeRowId(path, "1"),
        colId: "customer",
      });
    } finally {
      session.dispose();
    }
  });

  it("PageDown clamps within the loaded host-owned page before changing pages", async () => {
    const rowsClient: TableRowsClient = {
      fetch: vi.fn(async ({ page }) => ({
        data:
          page === 1
            ? [
                { id: 1, customer: "Acme", status: "open" },
                { id: 2, customer: "Beta", status: "open" },
              ]
            : [{ id: 3, customer: "Core", status: "open" }],
        meta: { total: 3, page, limit: 2, pages: 2 },
      })),
      create: vi.fn(async (_table, data) => ({ data })),
      update: vi.fn(async (_table, _id, data) => ({ data })),
      remove: vi.fn(async (_table, id) => ({ data: { id } })),
    };
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: { owner: "host", pageSize: 2 },
          rowsClient,
        },
      },
    });
    const onQueryUrlChange = vi.fn();
    const session = createTGridSession<RowsByLevel>(definition, {
      onQueryUrlChange,
      onLoadedRowsBoundary: paginateLoadedRowsForTest,
    });

    try {
      await flush();
      const path = rootPath("orders");
      const cursors = cursorManagerFor(session.runtime);
      const controller = controllerFor(session.runtime, path);
      cursors.moveCellCursorTo({
        path,
        rowId: makeRowId(path, "1"),
        colId: "customer",
      });

      controller.handleKey(keyEvent("PageDown"));
      await flush();

      expect(session.getQueryState().page).toBe(1);
      expect(onQueryUrlChange).not.toHaveBeenCalled();
      expect(cursors.currentCellCursor()).toEqual({
        path,
        rowId: makeRowId(path, "2"),
        colId: "customer",
      });

      controller.handleKey(keyEvent("PageDown"));
      await flush();

      expect(session.getQueryState().page).toBe(2);
      expect(onQueryUrlChange).toHaveBeenCalledWith({
        level: "orders",
        page: 2,
        sort: [],
        filters: [],
        search: null,
      });
      expect(cursors.currentCellCursor()).toEqual({
        path,
        rowId: makeRowId(path, "3"),
        colId: "customer",
      });
    } finally {
      session.dispose();
    }
  });

  it("does not advance host-owned page navigation again while the source is loading", async () => {
    const page2 = deferred<Awaited<ReturnType<TableRowsClient["fetch"]>>>();
    const page3 = deferred<Awaited<ReturnType<TableRowsClient["fetch"]>>>();
    const rowsClient: TableRowsClient = {
      fetch: vi.fn(async ({ page }) => {
        if (page === 1) {
          return {
            data: [{ id: 1, customer: "Acme", status: "open" }],
            meta: { total: 3, page, limit: 1, pages: 3 },
          };
        }
        if (page === 2) return page2.promise;
        if (page === 3) return page3.promise;
        return {
          data: [],
          meta: { total: 3, page, limit: 1, pages: 3 },
        };
      }),
      create: vi.fn(async (_table, data) => ({ data })),
      update: vi.fn(async (_table, _id, data) => ({ data })),
      remove: vi.fn(async (_table, id) => ({ data: { id } })),
    };
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: { owner: "host", pageSize: 1 },
          rowsClient,
        },
      },
    });
    const onQueryUrlChange = vi.fn();
    const session = createTGridSession<RowsByLevel>(definition, {
      onQueryUrlChange,
      onLoadedRowsBoundary: paginateLoadedRowsForTest,
    });

    try {
      await flush();
      const path = rootPath("orders");
      const cursors = cursorManagerFor(session.runtime);
      const controller = controllerFor(session.runtime, path);
      cursors.moveCellCursorTo({
        path,
        rowId: makeRowId(path, "1"),
        colId: "customer",
      });

      controller.handleKey(keyEvent("ArrowDown"));
      await flush();

      expect(session.getQueryState().page).toBe(2);
      expect(rowsClient.fetch).toHaveBeenCalledTimes(2);

      controller.handleKey(keyEvent("ArrowDown"));
      await flush();

      expect(session.getQueryState().page).toBe(2);
      expect(rowsClient.fetch).toHaveBeenCalledTimes(2);
      expect(onQueryUrlChange).not.toHaveBeenCalled();

      page2.resolve({
        data: [{ id: 2, customer: "Beta", status: "open" }],
        meta: { total: 3, page: 2, limit: 1, pages: 3 },
      });
      await flush();

      expect(onQueryUrlChange).toHaveBeenCalledWith({
        level: "orders",
        page: 2,
        sort: [],
        filters: [],
        search: null,
      });

      expect(cursors.currentCellCursor()).toEqual({
        path,
        rowId: makeRowId(path, "2"),
        colId: "customer",
      });

      controller.handleKey(keyEvent("ArrowDown"));
      await flush();

      expect(session.getQueryState().page).toBe(3);
      expect(rowsClient.fetch).toHaveBeenCalledTimes(3);
      expect(onQueryUrlChange).toHaveBeenCalledTimes(1);

      page3.resolve({
        data: [{ id: 3, customer: "Core", status: "open" }],
        meta: { total: 3, page: 3, limit: 1, pages: 3 },
      });
      await flush();

      expect(onQueryUrlChange).toHaveBeenLastCalledWith({
        level: "orders",
        page: 3,
        sort: [],
        filters: [],
        search: null,
      });
    } finally {
      session.dispose();
    }
  });
});
