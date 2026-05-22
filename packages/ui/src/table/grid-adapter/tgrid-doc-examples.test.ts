import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  bindTGridTypes,
  buildTGridRuntimeConfig,
  createTGridColumnMapper,
  type TGridCellWriteContext,
  type TGridColumnsBuilder,
} from "@/index";
import type { TGridLookupResolver } from "./tgrid-lookup-resolver";

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
  columns: [
    { name: "id", kind: "text", primary: true },
    { name: "customer_id", kind: "text" },
    { name: "invoice_date", kind: "date" },
    { name: "due_date", kind: "date" },
    { name: "status", kind: "text", select: { options: ["draft", "sent", "paid"] } },
  ],
  children: [],
  search: { columns: ["customer_id"] },
};

const invoiceItemsTable: TableSchema = {
  name: "invoice_items",
  label: "Invoice items",
  immutable: false,
  columns: [
    { name: "id", kind: "text", primary: true },
    { name: "invoice_id", kind: "text" },
    { name: "item_id", kind: "text" },
    { name: "quantity", kind: "number" },
    { name: "balance_stock", kind: "number" },
  ],
  children: [],
};

const invoicesGrid = bindTGridTypes<RowsByLevel, AppServices>();

function PaymentStatusCell() {
  const cell = invoicesGrid.useCell("invoices");
  return createElement("span", null, cell.row.status);
}

function OverdueDaysCell() {
  const cell = invoicesGrid.useCell("invoices");
  return createElement("span", null, cell.row.due_date ?? "");
}

function StockHoldCell() {
  const cell = invoicesGrid.useCell("invoices.items");
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
    columns.table("item_id", { header: "Item" }),
    columns.table("quantity", {
      header: "Qty",
      saveCellValue: saveQuantity,
    }),
    columns.table("balance_stock", { header: "Stock", editable: false }),
    columns.client("stock_hold", {
      header: "Hold",
      width: 120,
      readsRowFields: ["stock_hold_expires_at"],
      invalidatedBy: ["stock_hold_expires_at"],
      renderCell: StockHoldCell,
    }),
  ];
}

const lookupResolver: TGridLookupResolver = {
  bundleFor: () => undefined,
};

describe("TGRID-USAGE examples", () => {
  it("compiles documented multi-level column builders and session API", () => {
    // 1. Verify runtime schema building and `remainingTable` dynamic expansion
    const config = buildTGridRuntimeConfig<RowsByLevel, AppServices>({
      rootLevel: "invoices",
      levels: {
        invoices: invoicesGrid.level("invoices", {
          table: invoicesTable,
          childLevels: ["invoices.items"],
          columns: (columns) => [
            columns.table("customer_id", { header: "Customer" }),
            columns.table("invoice_date", { header: "Date", editable: false }),
            columns.table("status", {
              header: "Payment",
              renderCell: PaymentStatusCell,
              readsRowFields: ["status"],
              invalidatedBy: ["status"],
            }),
            columns.client("overdue_days", {
              header: "Overdue",
              width: 96,
              readsRowFields: ["due_date", "status"],
              invalidatedBy: ["due_date", "status"],
              renderCell: OverdueDaysCell,
            }),
            columns.remainingTable({ exclude: ["id", "customer_id"] }),
          ],
        }),
        "invoices.items": invoicesGrid.level("invoices.items", {
          table: invoiceItemsTable,
          parent: { level: "invoices", foreignKey: "invoice_id" },
          childLevels: [],
          columns: buildOrderItemColumns,
        }),
      },
      columnMapper: createTGridColumnMapper(lookupResolver),
      hostQueryState: () => ({
        page: 1,
        pageSize: 50,
        sort: [],
        filters: [],
        search: null,
      }),
    });

    expect(config.gridSchema.levels.invoices.columns.map((c) => c.id)).toEqual([
      "customer_id",
      "invoice_date",
      "status",
      "overdue_days",
      "due_date",
    ]);
    expect(
      config.gridSchema.levels["invoices.items"].columns.map((c) => c.id),
    ).toEqual(["item_id", "quantity", "balance_stock", "stock_hold"]);

    // 2. Type-check the createSession API (purely for doc example validation)
    const session = invoicesGrid.createSession({
      rootLevel: "invoices",
      appServices: {
        stockAvailable: async () => ({
          available: true,
          balanceStock: 8,
          holdExpiresAt: "2026-05-23T10:30:00.000Z",
        }),
      },
      levels: {
        invoices: invoicesGrid.level("invoices", {
          table: invoicesTable,
          childLevels: ["invoices.items"],
          query: {
            owner: "host",
            pageSize: 50,
            initialSort: [{ colId: "invoice_date", direction: "desc" }],
            urlSync: true,
          },
          columns: (columns) => [
            columns.table("customer_id", { header: "Customer" }),
            columns.table("invoice_date", { header: "Date" }),
            columns.table("status", { header: "Status" }),
            columns.remainingTable({ exclude: ["id"] }),
          ],
        }),
        "invoices.items": invoicesGrid.level("invoices.items", {
          table: invoiceItemsTable,
          parent: {
            level: "invoices",
            foreignKey: "invoice_id",
            defaultSort: "item_id",
          },
          childLevels: [],
          query: { owner: "source", pageSize: 25 },
          columns: buildOrderItemColumns,
        }),
      },
    });

    expect(session.levels["invoices.items"]).toBeDefined();
    session.dispose();
  });
});
