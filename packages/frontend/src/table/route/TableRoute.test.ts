// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import type { TablePageProps } from "../page/TablePage";
import { TableRoute, type TableGridOptionsByTable } from "./TableRoute";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { tablePageSpy } = vi.hoisted(() => ({
  tablePageSpy: vi.fn(),
}));

vi.mock("../page/TablePage", async () => {
  const React = await import("react");
  return {
    TablePage: (props: TablePageProps): ReactElement => {
      tablePageSpy(props);
      return React.createElement("div", null, "table page");
    },
  };
});

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

const quotesTable: TableSchema = {
  name: "quotes",
  label: "Quotes",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["text"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "text" },
    { name: "text", label: "Text", kind: "text" },
  ],
  children: [],
};

let mounted: { root: Root; container: HTMLElement } | null = null;

async function renderTableRoute(
  initialPath: string,
  gridOptionsByTable?: TableGridOptionsByTable,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/tables/:tableName",
            element: createElement(TableRoute, { gridOptionsByTable }),
          }),
        ),
      ),
    );
  });

  mounted = { root, container };
  return container;
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

function lastTablePageProps(): TablePageProps {
  const call = tablePageSpy.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call?.[0] as TablePageProps;
}

describe("TableRoute", () => {
  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
    useSchemaStore.getState().reset();
    tablePageSpy.mockClear();
  });

  it("passes options for the current table route parameter", async () => {
    useSchemaStore.getState().setTables([ordersTable, quotesTable]);
    const orderGridOptions = {
      rootRows: { pageSize: 15 },
    };

    await renderTableRoute("/tables/orders", {
      orders: orderGridOptions,
      quotes: { rootRows: { pageSize: 25 } },
    });

    expect(tablePageSpy).toHaveBeenCalled();
    expect(lastTablePageProps()).toEqual({
      tableName: "orders",
      gridOptions: orderGridOptions,
    });
    expect(useSchemaStore.getState().activeTable).toBe("orders");
  });

  it("leaves unconfigured tables on the standard defaults", async () => {
    useSchemaStore.getState().setTables([ordersTable, quotesTable]);

    await renderTableRoute("/tables/quotes", {
      orders: { rootRows: { pageSize: 15 } },
    });

    expect(tablePageSpy).toHaveBeenCalled();
    expect(lastTablePageProps()).toEqual({
      tableName: "quotes",
      gridOptions: undefined,
    });
  });

  it("does not render a table page while schemas are not loaded", async () => {
    const container = await renderTableRoute("/tables/orders");

    expect(container.textContent).toBe("");
    expect(tablePageSpy).not.toHaveBeenCalled();
  });

  it("keeps table-not-found behavior for unknown table names", async () => {
    useSchemaStore.getState().setTables([ordersTable]);

    const container = await renderTableRoute("/tables/missing");

    expect(container.textContent).toContain("Table not found");
    expect(container.textContent).toContain(
      'We could not find the schema for "missing".',
    );
    expect(tablePageSpy).not.toHaveBeenCalled();
  });
});
