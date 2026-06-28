// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROW_PRIMARY_MASTER_DETAIL,
  type GridInteractionConfig,
} from "@sapporta/grid";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TGridDefinition } from "@/table/grid-adapter/tgrid-runtime-config";
import type { SchemaTableRowsByLevel } from "@/table/grid-adapter/schema-tgrid";
import type { TableGridViewProps } from "./TableGridView";
import {
  SchemaTableGridView,
  type SchemaTableGridViewProps,
} from "./SchemaTableGridView";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type CapturedTableGridViewProps = TableGridViewProps<SchemaTableRowsByLevel>;

const { tableGridViewSpy } = vi.hoisted(() => ({
  tableGridViewSpy: vi.fn(
    (_props: CapturedTableGridViewProps): ReactElement =>
      createElement("div", null, "table grid view"),
  ),
}));

vi.mock("./TableGridView", () => ({
  TableGridView: (props: CapturedTableGridViewProps) => tableGridViewSpy(props),
}));

const ordersTable: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  rowLabelColumns: ["customer"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "text" },
    { name: "customer", label: "Customer", kind: "text" },
  ],
  children: [
    {
      table: "order_lines",
      foreignKey: "order_id",
      label: "Order lines",
      columns: ["line_no"],
      defaultSort: "line_no",
    },
  ],
};

const orderLinesTable: TableSchema = {
  name: "order_lines",
  label: "Order lines",
  immutable: false,
  rowLabelColumns: ["line_no"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "text" },
    { name: "order_id", label: "Order", kind: "text" },
    { name: "line_no", label: "Line no", kind: "number" },
  ],
  children: [],
};

async function render(element: ReactElement): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

let mounted: { root: Root; container: HTMLElement } | null = null;

async function renderSchemaTableGridView(
  props: Partial<SchemaTableGridViewProps> = {},
): Promise<CapturedTableGridViewProps> {
  const navigate = vi.fn();
  mounted = await render(
    createElement(SchemaTableGridView, {
      source: {
        table: ordersTable,
        tablesByName: { orders: ordersTable, order_lines: orderLinesTable },
      },
      route: {
        path: "/orders-workbench",
        searchParams: new URLSearchParams(),
        navigate,
      },
      registerAs: "orders",
      ...props,
    }),
  );

  expect(tableGridViewSpy).toHaveBeenCalledTimes(1);
  return tableGridViewSpy.mock.calls[0]?.[0] as CapturedTableGridViewProps;
}

describe("SchemaTableGridView", () => {
  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
    tableGridViewSpy.mockClear();
  });

  it("renders a schema table grid at the route path", async () => {
    const navigate = vi.fn();
    mounted = await render(
      createElement(SchemaTableGridView, {
        source: {
          table: ordersTable,
          tablesByName: { orders: ordersTable, order_lines: orderLinesTable },
        },
        route: {
          path: "/orders-workbench",
          searchParams: new URLSearchParams(),
          navigate,
        },
        registerAs: "orders",
      }),
    );

    expect(tableGridViewSpy).toHaveBeenCalledTimes(1);
    const props = tableGridViewSpy.mock.calls[0]?.[0];
    expect(props?.route.path).toBe("/orders-workbench");
    expect(props?.registerAs).toBe("orders");
    expect(props?.route.navigate).toBe(navigate);

    const definition = props?.definition as
      | TGridDefinition<SchemaTableRowsByLevel>
      | undefined;
    expect(definition?.rootLevel).toBe("orders");
    expect(definition?.levels.orders.query).toMatchObject({
      owner: "host",
      urlSync: true,
    });
  });

  it("applies root row options while preserving URL sync by default", async () => {
    const props = await renderSchemaTableGridView({
      rootRows: {
        pageSize: 15,
        initialSearch: "open",
      },
    });

    expect(props.definition.levels.orders.query).toMatchObject({
      owner: "host",
      urlSync: true,
      pageSize: 15,
      initialSearch: "open",
    });
  });

  it("lets root row options explicitly disable URL sync", async () => {
    const props = await renderSchemaTableGridView({
      rootRows: {
        urlSync: false,
      },
    });

    expect(props.definition.levels.orders.query).toMatchObject({
      owner: "host",
      urlSync: false,
    });
  });

  it("keeps the grid definition stable when row option objects are recreated", async () => {
    const navigate = vi.fn();
    const source = {
      table: ordersTable,
      tablesByName: { orders: ordersTable, order_lines: orderLinesTable },
    };
    const route = {
      path: "/orders-workbench",
      searchParams: new URLSearchParams(),
      navigate,
    };
    const renderView = (): ReactElement =>
      createElement(SchemaTableGridView, {
        source,
        route,
        registerAs: "orders",
        rootRows: { pageSize: 15, initialSearch: "open" },
        relatedRows: { pageSize: 25, initialPage: 3 },
        interaction: {
          mode: "row-list",
          activeCell: { kind: "none" },
          selectedCells: { kind: "none" },
          activeRow: {
            kind: "from-row-cursor",
            keyboard: {
              arrows: "move-active-row",
              shiftArrows: "move-active-row",
              expansion: "left-right-enter",
            },
          },
          selectedRows: {
            kind: "enabled",
            mode: "single",
            sync: { kind: "follows-active-row" },
            keyboard: { space: "ignore" },
          },
        } satisfies GridInteractionConfig,
      });

    mounted = await render(renderView());
    expect(tableGridViewSpy).toHaveBeenCalledTimes(1);
    const firstDefinition = tableGridViewSpy.mock.calls[0]?.[0].definition;

    await act(async () => {
      mounted?.root.render(renderView());
    });

    expect(tableGridViewSpy).toHaveBeenCalledTimes(2);
    expect(tableGridViewSpy.mock.calls[1]?.[0].definition).toBe(
      firstDefinition,
    );
  });

  it("applies related row options to child levels", async () => {
    const props = await renderSchemaTableGridView({
      relatedRows: {
        pageSize: 25,
        initialPage: 3,
      },
    });

    expect(props.definition.levels["orders.order_lines"].query).toMatchObject({
      owner: "source",
      pageSize: 25,
      initialPage: 3,
    });
  });

  it("applies the selected row interaction mode", async () => {
    const props = await renderSchemaTableGridView({
      interaction: ROW_PRIMARY_MASTER_DETAIL,
    });

    expect(props.definition.interaction).toStrictEqual(
      ROW_PRIMARY_MASTER_DETAIL,
    );
  });

  it("forwards table grid behavior options to TableGridView", async () => {
    const props = await renderSchemaTableGridView({
      loadLookups: false,
      className: "table-page",
      gridClassName: "table-grid",
    });

    expect(props.loadLookups).toBe(false);
    expect(props.className).toBe("table-page");
    expect(props.gridClassName).toBe("table-grid");
  });
});
