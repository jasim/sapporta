import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { eqCondition } from "@sapporta/shared/filter";
import { createTGridSession } from "./tgrid-session";
import { defineTGrid } from "@/table/grid-adapter/tgrid-runtime-config";

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
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "customer", label: "Customer", kind: "text" },
    { name: "status", label: "Status", kind: "text" },
  ],
  children: [],
};

describe("TGridSession", () => {
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
        filters: [initialFilter],
        search: "acme",
        page: 2,
      });
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
          filters: [eqCondition("customer", "ACME")],
          search: null,
          sort: [],
        },
      },
    });

    try {
      session.queryStore.getState().syncFromUrl({});
      expect(session.getQueryState()).toMatchObject({
        page: 2,
        filters: [initialFilter],
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
          filters: [eqCondition("customer", "ACME")],
        },
      },
    });

    try {
      const url = new URL(session.csvExportUrl(), "http://localhost");
      expect(url.pathname).toBe("/api/tables/orders/export.csv");
      expect(url.searchParams.get("filter[status][eq]")).toBe("open");
      expect(url.searchParams.get("filter[customer][eq]")).toBe("ACME");
    } finally {
      session.dispose();
    }
  });
});
