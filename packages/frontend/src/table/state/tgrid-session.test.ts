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
    { name: "id", primary: true, kind: "number" },
    { name: "customer", kind: "text" },
    { name: "status", kind: "text" },
  ],
  children: [],
};

describe("TGridSession", () => {
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
      hostQuerySeeds: {
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
