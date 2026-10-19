import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { setNavigate } from "../../app/router/router-bridge";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { showTableRowState, tableReturnState } from "../page/show-table-row";
import { createRecord, navigateToNewRecord } from "./record-actions";

const { createTableRow } = vi.hoisted(() => ({ createTableRow: vi.fn() }));
vi.mock("../api/rows", () => ({ createTableRow }));

const ordersTable: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["customer"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "text" },
    { name: "customer", label: "Customer", kind: "text" },
  ],
  children: [],
};

afterEach(() => {
  useSchemaStore.getState().reset();
  createTableRow.mockReset();
});

describe("createRecord", () => {
  it("opens the table on the row it created", async () => {
    useSchemaStore.getState().setTables([ordersTable]);
    createTableRow.mockResolvedValue({
      data: { id: "050505", customer: "sample" },
    });
    const navigate = vi.fn();
    setNavigate(navigate);

    await createRecord("orders", { customer: "sample" });

    expect(navigate).toHaveBeenCalledWith("/tables/orders", {
      replace: true,
      state: showTableRowState("orders", "050505", {
        id: "050505",
        customer: "sample",
      }),
    });
  });
});

describe("navigateToNewRecord", () => {
  it("carries the table page's query string to the form", () => {
    const navigate = vi.fn();
    setNavigate(navigate);

    navigateToNewRecord("orders", "page=3&sort=-customer");
    expect(navigate).toHaveBeenCalledWith("/tables/orders/new", {
      state: tableReturnState("page=3&sort=-customer"),
    });

    navigateToNewRecord("orders");
    expect(navigate).toHaveBeenLastCalledWith("/tables/orders/new", undefined);
  });
});
