import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  showCreatedRowState,
  showTableRowState,
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
    expect(tableRowToShow(state, "orders")).toBe("050505");
    expect(tableRowToShow(state, "order_lines")).toBeNull();
    expect(tableRowToShow(null, "orders")).toBeNull();
    expect(tableRowToShow({ from: "/" }, "orders")).toBeNull();
  });

  it("asks to show a created row by its primary key", () => {
    expect(
      showCreatedRowState(table, { code: 50505, customer: "sample" }),
    ).toEqual(showTableRowState("orders", "50505"));
    expect(
      showCreatedRowState(table, [
        { code: "050505001" },
        { code: "050505002" },
      ]),
    ).toEqual(showTableRowState("orders", "050505001"));
    expect(showCreatedRowState(table, { customer: "sample" })).toBeUndefined();
    expect(showCreatedRowState(table, [])).toBeUndefined();
  });
});
