// @vitest-environment happy-dom

import {
  act,
  createRef,
  createElement,
  type ComponentType,
  type ReactElement,
  type RefCallback,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROW_PRIMARY_MASTER_DETAIL,
  type GridInteractionConfig,
} from "@sapporta/grid";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TGridDefinition } from "../tgrid/tgrid-runtime-config";
import type { SchemaTableRowsByLevel } from "../tgrid/schema-tgrid";
import {
  SchemaTableGridView as PublicSchemaTableGridView,
  type TableGridActionsProps as PublicTableGridActionsProps,
  type TableGridOptionsByTable,
  type TablePageGridOptions,
  type TGridSession as PublicTGridSession,
} from "../../index";
import type { TableGridActionsProps as TablePublicActionsProps } from "../index";
import type { CreateTGridSessionArgs } from "../tgrid/tgrid-session";
import {
  type TableGridBinding,
  type TableGridViewProps,
} from "./TableGridView";
import {
  SchemaTableGridView,
  type SchemaTableGridViewProps,
  useSchemaTableGrid,
} from "./SchemaTableGridView";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type CapturedTableGridViewProps = TableGridViewProps<SchemaTableRowsByLevel>;

const { tableGridViewSpy, useTGridSessionSpy } = vi.hoisted(() => ({
  tableGridViewSpy: vi.fn((_props: CapturedTableGridViewProps): ReactElement =>
    createElement("div", null, "table grid view"),
  ),
  useTGridSessionSpy: vi.fn(),
}));

vi.mock("./TableGridView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./TableGridView")>();
  return {
    ...actual,
    TableGridView: (props: CapturedTableGridViewProps) =>
      tableGridViewSpy(props),
  };
});

vi.mock("../tgrid/tgrid-binding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../tgrid/tgrid-binding")>();
  return {
    ...actual,
    useTGridSession: (...args: unknown[]) => {
      useTGridSessionSpy(...args);
      return null;
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
  searchable: true,
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
    useTGridSessionSpy.mockClear();
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
      TGridDefinition<SchemaTableRowsByLevel> | undefined;
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
              expansion: "enabled",
            },
          },
          selectedRows: {
            kind: "enabled",
            mode: "single",
            sync: { kind: "follows-active-row" },
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

  it("forwards actions without adding them to the TGrid definition", async () => {
    const Actions = (
      _props: PublicTableGridActionsProps<SchemaTableRowsByLevel>,
    ) => createElement("button", null, "Archive orders");
    const props = await renderSchemaTableGridView({ actions: Actions });

    expect(props.actions).toBe(Actions);
    expect(props.definition).not.toHaveProperty("actions");
    expect(props.definition.levels.orders).not.toHaveProperty("actions");
  });

  it("forwards the session ref without adding it to the TGrid definition", async () => {
    const sessionRef: RefCallback<
      PublicTGridSession<SchemaTableRowsByLevel>
    > = () => undefined;
    const props = await renderSchemaTableGridView({ sessionRef });

    expect(props.sessionRef).toBe(sessionRef);
    expect(props.definition).not.toHaveProperty("sessionRef");
    expect(props.definition.levels.orders).not.toHaveProperty("sessionRef");
  });

  it("preserves actions through useSchemaTableGrid and useTableGrid on the binding", async () => {
    const Actions = (
      _props: PublicTableGridActionsProps<SchemaTableRowsByLevel>,
    ) => null;
    let binding: TableGridBinding<SchemaTableRowsByLevel> | undefined;
    const source = {
      table: ordersTable,
      tablesByName: { orders: ordersTable, order_lines: orderLinesTable },
    };
    const route = {
      path: "/orders-workbench",
      searchParams: new URLSearchParams(),
      navigate: vi.fn(),
    };

    function BindingProbe(): ReactElement | null {
      binding = useSchemaTableGrid({
        source,
        route,
        registerAs: "orders",
        loadLookups: false,
        actions: Actions,
      });
      return null;
    }

    mounted = await render(createElement(BindingProbe));

    expect(binding?.actions).toBe(Actions);
    expect(binding?.level).toBe("orders");
  });

  it("leaves loaded-row boundary policy unset in the lower-level hook", async () => {
    const source = {
      table: ordersTable,
      tablesByName: { orders: ordersTable, order_lines: orderLinesTable },
    };
    const route = {
      path: "/orders-workbench",
      searchParams: new URLSearchParams(),
      navigate: vi.fn(),
    };

    function BindingProbe(): ReactElement | null {
      useSchemaTableGrid({
        source,
        route,
        loadLookups: false,
      });
      return null;
    }

    mounted = await render(createElement(BindingProbe));

    const args = useTGridSessionSpy.mock.calls[0]?.[1] as
      CreateTGridSessionArgs<SchemaTableRowsByLevel> | undefined;
    expect(args?.onLoadedRowsBoundary).toBeUndefined();
  });

  it("installs the pager-focus boundary policy in the standard view", async () => {
    const actual =
      await vi.importActual<typeof import("./TableGridView")>(
        "./TableGridView",
      );
    const definition = {
      rootLevel: "orders",
    } as unknown as TGridDefinition<SchemaTableRowsByLevel>;
    const ActualTableGridView = actual.TableGridView<SchemaTableRowsByLevel>;

    mounted = await render(
      createElement(ActualTableGridView, {
        definition,
        table: ordersTable,
        route: {
          path: "/orders-workbench",
          searchParams: new URLSearchParams(),
          navigate: vi.fn(),
        },
        loadLookups: false,
      }),
    );

    const args = useTGridSessionSpy.mock.calls[0]?.[1] as
      CreateTGridSessionArgs<SchemaTableRowsByLevel> | undefined;
    expect(args?.onLoadedRowsBoundary).toEqual(expect.any(Function));
  });

  it("forwards a custom loaded-row boundary policy through the schema hook", async () => {
    const source = {
      table: ordersTable,
      tablesByName: { orders: ordersTable, order_lines: orderLinesTable },
    };
    const route = {
      path: "/orders-workbench",
      searchParams: new URLSearchParams(),
      navigate: vi.fn(),
    };
    const onLoadedRowsBoundary = vi.fn(() => false as const);

    function BindingProbe(): ReactElement | null {
      useSchemaTableGrid({
        source,
        route,
        loadLookups: false,
        onLoadedRowsBoundary,
      });
      return null;
    }

    mounted = await render(createElement(BindingProbe));

    const args = useTGridSessionSpy.mock.calls[0]?.[1] as
      CreateTGridSessionArgs<SchemaTableRowsByLevel> | undefined;
    expect(args?.onLoadedRowsBoundary).toBe(onLoadedRowsBoundary);
  });

  it("lets the standard view replace its pager-focus boundary policy", async () => {
    const actual =
      await vi.importActual<typeof import("./TableGridView")>(
        "./TableGridView",
      );
    const definition = {
      rootLevel: "orders",
    } as unknown as TGridDefinition<SchemaTableRowsByLevel>;
    const onLoadedRowsBoundary = vi.fn(() => false as const);
    const ActualTableGridView = actual.TableGridView<SchemaTableRowsByLevel>;

    mounted = await render(
      createElement(ActualTableGridView, {
        definition,
        table: ordersTable,
        route: {
          path: "/orders-workbench",
          searchParams: new URLSearchParams(),
          navigate: vi.fn(),
        },
        loadLookups: false,
        onLoadedRowsBoundary,
      }),
    );

    const args = useTGridSessionSpy.mock.calls[0]?.[1] as
      CreateTGridSessionArgs<SchemaTableRowsByLevel> | undefined;
    expect(args?.onLoadedRowsBoundary).toBe(onLoadedRowsBoundary);
  });

  it("exposes actions and typed session refs through the public surfaces", () => {
    const Actions = (
      _props: PublicTableGridActionsProps<SchemaTableRowsByLevel>,
    ) => null;
    const TableSurfaceActions: ComponentType<
      TablePublicActionsProps<SchemaTableRowsByLevel>
    > = Actions;
    const callbackSessionRef: RefCallback<
      PublicTGridSession<SchemaTableRowsByLevel>
    > = () => undefined;
    const objectSessionRef =
      createRef<PublicTGridSession<SchemaTableRowsByLevel>>();
    const pageOptions = {
      actions: Actions,
      sessionRef: callbackSessionRef,
    } satisfies TablePageGridOptions;
    const objectRefOptions = {
      sessionRef: objectSessionRef,
    } satisfies TablePageGridOptions;
    const routeOptions = {
      orders: pageOptions,
    } satisfies TableGridOptionsByTable;

    expect(PublicSchemaTableGridView).toBe(SchemaTableGridView);
    expect(TableSurfaceActions).toBe(Actions);
    expect(routeOptions.orders.actions).toBe(Actions);
    expect(routeOptions.orders.sessionRef).toBe(callbackSessionRef);
    expect(objectRefOptions.sessionRef).toBe(objectSessionRef);
  });
});
