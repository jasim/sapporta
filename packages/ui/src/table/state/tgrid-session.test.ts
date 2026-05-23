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
  it("builds table page links from host query state", () => {
    const definition = defineTGrid<RowsByLevel>({
      rootLevel: "orders",
      levels: {
        orders: {
          table: ordersTable,
          childLevels: [],
          query: {
            owner: "host",
          },
        },
      },
    });
    const session = createTGridSession<RowsByLevel>(definition, {
      hostQuerySeeds: {
        orders: {
          sort: [{ colId: "customer", direction: "asc" }],
          filters: [eqCondition("status", "open")],
          search: "acme",
        },
      },
    });

    try {
      expect(session.tablePageUrl(3)).toBe(
        "/tables/orders?filter%5Bstatus%5D%5Beq%5D=open&page=3&sort=customer&q=acme",
      );
      expect(session.tablePageUrl(1)).toBe(
        "/tables/orders?filter%5Bstatus%5D%5Beq%5D=open&sort=customer&q=acme",
      );
    } finally {
      session.dispose();
    }
  });
});
