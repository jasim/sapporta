import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { CELL_EDITING_GRID, ROW_PRIMARY_MASTER_DETAIL } from "@sapporta/grid";
import {
  createTGridSession,
  defineTGrid,
  useTGridCell,
  type TGridCellWriteContext,
  type TGridColumnsBuilder,
} from "@/index";

type InvoiceRow = {
  id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string | null;
  status: "draft" | "sent" | "paid";
};

type InvoiceItemRow = {
  id: string;
  invoice_id: string;
  item_id: string | null;
  quantity: number;
  balance_stock: number | null;
  stock_hold_expires_at: string | null;
};

type RowsByLevel = {
  invoices: InvoiceRow;
  "invoices.items": InvoiceItemRow;
};

type InvoiceOnlyRowsByLevel = {
  invoices: InvoiceRow;
};

type AppServices = {
  stockAvailable(input: {
    lineId: string;
    itemId: string | null;
    quantity: number;
  }): Promise<{
    available: boolean;
    balanceStock: number;
    holdExpiresAt: string | null;
  }>;
};

const invoicesTable: TableSchema = {
  name: "invoices",
  label: "Invoices",
  immutable: false,
  rowLabelColumns: ["customer_id"],
  columns: [
    { name: "id", label: "ID", kind: "text", primary: true },
    { name: "customer_id", label: "Customer", kind: "text" },
    { name: "invoice_date", label: "Invoice date", kind: "date" },
    { name: "due_date", label: "Due date", kind: "date" },
    {
      name: "status",
      label: "Status",
      kind: "text",
      select: { options: ["draft", "sent", "paid"] },
    },
  ],
  children: [],
  search: { columns: ["customer_id"] },
};

const invoiceItemsTable: TableSchema = {
  name: "invoice_items",
  label: "Invoice items",
  immutable: false,
  rowLabelColumns: ["item_id"],
  columns: [
    { name: "id", label: "ID", kind: "text", primary: true },
    { name: "invoice_id", label: "Invoice", kind: "text" },
    { name: "item_id", label: "Item", kind: "text" },
    { name: "quantity", label: "Quantity", kind: "number" },
    { name: "balance_stock", label: "Balance stock", kind: "number" },
  ],
  children: [],
};

function PaymentStatusCell() {
  const cell = useTGridCell<RowsByLevel, AppServices, "invoices">("invoices");
  return createElement("span", null, cell.row.status);
}

function OverdueDaysCell() {
  const cell = useTGridCell<RowsByLevel, AppServices, "invoices">("invoices");
  return createElement("span", null, cell.row.due_date ?? "");
}

function StockHoldCell() {
  const cell = useTGridCell<RowsByLevel, AppServices, "invoices.items">(
    "invoices.items",
  );
  return createElement("span", null, cell.row.stock_hold_expires_at ?? "");
}

async function saveQuantity(
  ctx: TGridCellWriteContext<
    RowsByLevel,
    AppServices,
    "invoices.items",
    "quantity"
  >,
) {
  const availability = await ctx.appServices.stockAvailable({
    lineId: ctx.row.id,
    itemId: ctx.row.item_id,
    quantity: ctx.value,
  });

  if (!availability.available) {
    return {
      kind: "patch" as const,
      patch: {
        quantity: ctx.row.quantity,
        balance_stock: availability.balanceStock,
        stock_hold_expires_at: null,
      },
    };
  }

  return {
    kind: "patch" as const,
    patch: {
      quantity: ctx.value,
      balance_stock: availability.balanceStock,
      stock_hold_expires_at: availability.holdExpiresAt,
    },
  };
}

function buildOrderItemColumns(
  columns: TGridColumnsBuilder<RowsByLevel, AppServices, "invoices.items">,
) {
  return [
    columns.table("item_id", { label: "Item" }),
    columns.table("quantity", {
      label: "Qty",
      saveCellValue: saveQuantity,
    }),
    columns.table("balance_stock", { label: "Stock", editable: false }),
    columns.client("stock_hold", {
      label: "Hold",
      width: 120,
      renderCell: StockHoldCell,
    }),
  ];
}

describe("TGRID-USAGE examples", () => {
  it("compiles documented multi-level column builders and session API", () => {
    const definition = defineTGrid<RowsByLevel, AppServices>({
      rootLevel: "invoices",
      levels: {
        invoices: {
          table: invoicesTable,
          childLevels: ["invoices.items"],
          query: {
            owner: "host",
            pageSize: 50,
            urlSync: true,
          },
          columns: (columns) => [
            columns.table("customer_id", { label: "Customer" }),
            columns.table("invoice_date", { label: "Date", editable: false }),
            columns.table("status", {
              label: "Payment",
              renderCell: PaymentStatusCell,
            }),
            columns.client("overdue_days", {
              label: "Overdue",
              width: 96,
              renderCell: OverdueDaysCell,
            }),
            columns.remainingTable({ exclude: ["id", "customer_id"] }),
          ],
        },
        "invoices.items": {
          table: invoiceItemsTable,
          parent: {
            level: "invoices",
            foreignKey: "invoice_id",
            defaultSort: "item_id",
          },
          childLevels: [],
          query: { owner: "source", pageSize: 25 },
          columns: buildOrderItemColumns,
        },
      },
    });
    const session = createTGridSession(definition, {
      services: {
        stockAvailable: async () => ({
          available: true,
          balanceStock: 8,
          holdExpiresAt: "2026-05-23T10:30:00.000Z",
        }),
      },
      routeQuerySeeds: {
        invoices: {
          sort: [{ colId: "invoice_date", direction: "desc" }],
        },
      },
    });

    expect(
      session.runtime.schema.levels.invoices.columns.map((c) => c.id),
    ).toEqual([
      "customer_id",
      "invoice_date",
      "status",
      "overdue_days",
      "due_date",
    ]);
    expect(
      session.runtime.schema.levels["invoices.items"].columns.map((c) => c.id),
    ).toEqual(["item_id", "quantity", "balance_stock", "stock_hold"]);
    expect(session.levels["invoices.items"]).toBeDefined();
    session.dispose();
  });

  it("passes interaction presets from a TGrid definition into the runtime", () => {
    const rowPrimaryDefinition = defineTGrid<
      InvoiceOnlyRowsByLevel,
      AppServices
    >({
      rootLevel: "invoices",
      interaction: ROW_PRIMARY_MASTER_DETAIL,
      levels: {
        invoices: {
          table: invoicesTable,
          childLevels: [],
          query: { owner: "host", pageSize: 50 },
          columns: (columns) => [
            columns.table("customer_id", { editable: false }),
          ],
        },
      },
    });

    const rowPrimarySession = createTGridSession(rowPrimaryDefinition);
    try {
      expect(rowPrimarySession.runtime.interaction).toBe(
        ROW_PRIMARY_MASTER_DETAIL,
      );
    } finally {
      rowPrimarySession.dispose();
    }

    const defaultDefinition = defineTGrid<InvoiceOnlyRowsByLevel, AppServices>({
      rootLevel: "invoices",
      levels: {
        invoices: {
          table: invoicesTable,
          childLevels: [],
          query: { owner: "host", pageSize: 50 },
        },
      },
    });

    const defaultSession = createTGridSession(defaultDefinition);
    try {
      expect(defaultSession.runtime.interaction).toBe(CELL_EDITING_GRID);
    } finally {
      defaultSession.dispose();
    }
  });
});
