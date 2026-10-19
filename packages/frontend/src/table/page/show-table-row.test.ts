import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  showCreatedRowState,
  showTableRowState,
  tableReturnState,
  tableReturnUrl,
  tableRowToShow,
} from "./show-table-row";

const table: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["customer"],
  columns: [
    { name: "code", label: "Code", primary: true, kind: "text" },
    { name: "customer", label: "Customer", kind: "text" },
  ],
  children: [],
};

describe("showing a table row on arrival", () => {
  it("reads the row a location asks this table to show", () => {
    const state = showTableRowState("orders", "050505");
    expect(tableRowToShow(state, "orders")).toEqual({ rowKey: "050505" });
    const saved = { code: "050505", customer: "sample" };
    expect(
      tableRowToShow(showTableRowState("orders", "050505", saved), "orders"),
    ).toEqual({ rowKey: "050505", savedRow: saved });
    expect(tableRowToShow(state, "order_lines")).toBeNull();
    expect(tableRowToShow(null, "orders")).toBeNull();
    expect(tableRowToShow({ from: "/" }, "orders")).toBeNull();
  });

  it("asks to show a created row by its primary key, with the saved row", () => {
    expect(
      showCreatedRowState(table, { code: 50505, customer: "sample" }),
    ).toEqual(
      showTableRowState("orders", "50505", { code: 50505, customer: "sample" }),
    );
    expect(
      showCreatedRowState(table, [
        { code: "050505001" },
        { code: "050505002" },
      ]),
    ).toEqual(showTableRowState("orders", "050505001", { code: "050505001" }));
    expect(showCreatedRowState(table, { customer: "sample" })).toBeUndefined();
    expect(showCreatedRowState(table, [])).toBeUndefined();
  });

  it("returns to the table page's query string", () => {
    expect(
      tableReturnUrl("orders", tableReturnState("page=3&sort=-customer")),
    ).toBe("/tables/orders?page=3&sort=-customer");
    expect(tableReturnUrl("orders", tableReturnState("?page=3"))).toBe(
      "/tables/orders?page=3",
    );
    expect(tableReturnUrl("orders", tableReturnState(""))).toBe(
      "/tables/orders",
    );
    expect(tableReturnUrl("orders", null)).toBe("/tables/orders");
  });
});
