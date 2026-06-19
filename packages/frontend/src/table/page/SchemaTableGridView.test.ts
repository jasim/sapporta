// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TGridDefinition } from "@/table/grid-adapter/tgrid-runtime-config";
import type { SchemaTableRowsByLevel } from "@/table/grid-adapter/schema-tgrid";
import type { TableGridViewProps } from "./TableGridView";
import { SchemaTableGridView } from "./SchemaTableGridView";

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

describe("SchemaTableGridView", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
    tableGridViewSpy.mockClear();
  });

  it("creates a schema definition and renders TableGridView at the route path", async () => {
    const navigate = vi.fn();
    mounted = await render(
      createElement(SchemaTableGridView, {
        source: {
          table: ordersTable,
          tablesByName: { orders: ordersTable },
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
});
