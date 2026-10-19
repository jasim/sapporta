// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, type Location } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { TablePage, type TablePageGridOptions } from "./TablePage";
import type { SchemaTableGridViewProps } from "./SchemaTableGridView";
import { showTableRowState } from "./show-table-row";
import type { TGridSession } from "../tgrid/tgrid-session";
import type { SchemaTableRowsByLevel } from "../tgrid/schema-tgrid";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { schemaTableGridViewSpy } = vi.hoisted(() => ({
  schemaTableGridViewSpy: vi.fn(),
}));

vi.mock("./SchemaTableGridView", async () => {
  const React = await import("react");
  return {
    SchemaTableGridView: (props: SchemaTableGridViewProps): ReactElement => {
      schemaTableGridViewSpy(props);
      return React.createElement("div", null, "schema table grid");
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

let mounted: { root: Root; container: HTMLElement } | null = null;
let location: Location | null = null;

function LocationProbe() {
  location = useLocation();
  return null;
}

async function renderTablePage(
  gridOptions?: TablePageGridOptions,
  entry:
    | string
    | {
        pathname: string;
        search?: string;
        state?: unknown;
      } = "/tables/orders?page=2",
): Promise<SchemaTableGridViewProps> {
  useSchemaStore.getState().setTables([ordersTable, orderLinesTable]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [entry] },
        createElement(LocationProbe),
        createElement(TablePage, {
          tableName: "orders",
          gridOptions,
        }),
      ),
    );
  });

  mounted = { root, container };
  expect(schemaTableGridViewSpy).toHaveBeenCalledTimes(1);
  return schemaTableGridViewSpy.mock.calls[0]?.[0] as SchemaTableGridViewProps;
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe("TablePage", () => {
  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
    useSchemaStore.getState().reset();
    schemaTableGridViewSpy.mockClear();
  });

  it("keeps standard table route behavior when grid options are omitted", async () => {
    const props = await renderTablePage();

    expect(props.source).toEqual({
      table: ordersTable,
      tablesByName: {
        orders: ordersTable,
        order_lines: orderLinesTable,
      },
    });
    expect(props.route.path).toBe("/tables/orders");
    expect(props.route.searchParams.get("page")).toBe("2");
    expect(props.registerAs).toBe("orders");
    expect(props.onNewRecord).toEqual(expect.any(Function));
    expect(props.rootRows).toBeUndefined();
    expect(props.viewRelatedRows).toBe(true);
  });

  it("forwards root row options to the schema table grid view", async () => {
    const props = await renderTablePage({
      rootRows: {
        pageSize: 15,
      },
    });

    expect(props.rootRows).toEqual({ pageSize: 15 });
  });

  it("lets callers explicitly disable related row expansion", async () => {
    const props = await renderTablePage({
      viewRelatedRows: false,
    });

    expect(props.viewRelatedRows).toBe(false);
  });

  describe("opened to show a row", () => {
    type Session = TGridSession<SchemaTableRowsByLevel>;

    function fakeSession() {
      const showRow = vi.fn(async () => "shown" as const);
      return { session: { showRow } as unknown as Session, showRow };
    }

    async function giveSession(
      props: SchemaTableGridViewProps,
      session: Session,
    ) {
      const ref = props.sessionRef;
      if (typeof ref !== "function") throw new Error("no session callback");
      await act(async () => {
        ref(session);
      });
    }

    it("shows the row once the table has its session, then forgets it", async () => {
      const props = await renderTablePage(undefined, {
        pathname: "/tables/orders",
        search: "?q=sample",
        state: showTableRowState("orders", "050505"),
      });
      const { session, showRow } = fakeSession();

      await giveSession(props, session);

      expect(showRow).toHaveBeenCalledTimes(1);
      expect(showRow).toHaveBeenCalledWith("050505", {
        clearQueryIfHidden: true,
      });
      expect(location?.pathname).toBe("/tables/orders");
      expect(location?.search).toBe("?q=sample");
      expect(location?.state).toBeNull();
    });

    it("ignores a row another table was asked to show", async () => {
      const props = await renderTablePage(undefined, {
        pathname: "/tables/orders",
        state: showTableRowState("order_lines", "050505"),
      });
      const { session, showRow } = fakeSession();

      await giveSession(props, session);

      expect(showRow).not.toHaveBeenCalled();
    });

    it("still hands the session to a caller's own ref", async () => {
      const callerRef = { current: null as Session | null };
      const props = await renderTablePage({ sessionRef: callerRef });
      const { session } = fakeSession();

      await giveSession(props, session);

      expect(callerRef.current).toBe(session);
    });
  });
});
