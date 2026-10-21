// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import type {
  FetchPageRequest,
  RestEndpointFactory,
  RowQueryState,
} from "@sapporta/grid";
import { lookupEntryRenderer, preset } from "@sapporta/grid/column-preset";
import { createLookupStore, type RowDisplays } from "../../lookup";
import { compileTGridRuntimeConfig } from "./tgrid-runtime-config";
import { createTGridColumnMapper } from "./tgrid-column-mapper";
import type { TableRowsClient } from "./tgrid-level-config";
import type { TGridFilter } from "./tgrid-filter";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchLookup } = vi.hoisted(() => ({ fetchLookup: vi.fn() }));

vi.mock("../../lookup/api/lookup", () => ({
  fetchLookup,
  fetchLookupSearch: vi.fn(),
}));

const accounts: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "name", label: "Name", kind: "text" },
    {
      name: "parent_id",
      label: "Parent",
      kind: "number",
      foreignKey: { table: "accounts", column: "id" },
    },
  ],
  children: [],
  tree: {
    parentColumn: "parent_id",
    column: "name",
    defaultExpanded: true,
    matchContext: "ancestors-and-descendants",
  },
  computed: [
    { name: "parentPath", label: "Parent path", kind: "text" },
    { name: "balance", label: "Balance", kind: "number" },
  ],
  rowCaption: "parentPath",
};

type Rows = { accounts: Record<string, unknown> };

function rowsClient(): TableRowsClient & {
  fetch: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  return {
    fetch: vi.fn(async () => ({
      data: [{ id: 1, name: "Cash", parent_id: null }],
      meta: { total: 1, page: 1, limit: 50, pages: 1 },
      computed: { balance: { "1": 40 } },
    })),
    create: vi.fn(),
    update: vi.fn(async () => ({
      data: { id: 1, name: "Petty cash", parent_id: null },
    })),
    remove: vi.fn(),
  } as unknown as TableRowsClient & {
    fetch: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function compile(
  client: TableRowsClient,
  rowDisplays: RowDisplays = { accounts: { label: { needs: ["balance"] } } },
) {
  const store = createLookupStore({ tables: () => [accounts], rowDisplays });
  const config = compileTGridRuntimeConfig<Rows>({
    rootLevel: "accounts",
    levels: {
      accounts: {
        table: accounts,
        childLevels: [],
        query: { owner: "source" },
        rowsClient: client,
      },
    },
    columnMapper: createTGridColumnMapper({ lookups: store, rowData: store }),
    rowData: store,
  });
  return { store, config };
}

function rowsRequest(
  endpoint: ReturnType<RestEndpointFactory<TGridFilter>>,
): FetchPageRequest<TGridFilter> {
  const build =
    endpoint.buildRowsRequest ??
    ((query: ReturnType<RowQueryState<TGridFilter>["current"]>) => query);
  return build(endpoint.rowQuery.current());
}

describe("TGrid row display", () => {
  it("reads the label slot's needs with the page and stores them", async () => {
    const client = rowsClient();
    const { store, config } = compile(client);
    const endpoint = config.endpointFactoriesByLevel.accounts({
      ancestors: [],
    });

    await endpoint.fetchPage(rowsRequest(endpoint));

    expect(client.fetch.mock.calls[0]?.[0]).toMatchObject({
      computed: ["balance"],
    });
    expect(store.table("accounts").computedFor(1)).toEqual({ balance: 40 });
  });

  it("marks every value out of date after a write, and keeps it drawn", async () => {
    const client = rowsClient();
    const { store, config } = compile(client);
    const endpoint = config.endpointFactoriesByLevel.accounts({
      ancestors: [],
    });
    await endpoint.fetchPage(rowsRequest(endpoint));
    const other = store.table("other");
    const before = other.generation;

    await endpoint.patchCell!({
      rowKey: "1",
      colId: "name",
      value: "Petty cash",
      row: { id: 1, name: "Cash", parent_id: null },
    });

    expect(client.update).toHaveBeenCalledWith("accounts", "1", {
      name: "Petty cash",
    });
    expect(store.table("accounts").computedFor(1)).toEqual({ balance: 40 });
    expect(other.generation).toBe(before + 1);
  });

  it("reads a page's values again when a write lands while it loads", async () => {
    const client = rowsClient();
    let finishPage: (() => void) | undefined;
    client.fetch.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (finishPage = resolve));
      return {
        data: [{ id: 1, name: "Cash", parent_id: null }],
        meta: { total: 1, page: 1, limit: 50, pages: 1 },
        computed: { balance: { "1": 40 } },
      };
    });
    const { store, config } = compile(client);
    const endpoint = config.endpointFactoriesByLevel.accounts({
      ancestors: [],
    });
    const page = endpoint.fetchPage(rowsRequest(endpoint));
    await Promise.resolve();

    store.invalidateComputed();
    finishPage?.();
    await page;

    const data = store.table("accounts");
    expect(data.computedFor(1)).toEqual({ balance: 40 });
    expect(data.hasComputed(1, ["balance"])).toBe(true);
    fetchLookup.mockResolvedValueOnce({
      entries: [],
      computed: { balance: { "1": 41 } },
    });
    await data.ensureComputed([1], ["balance"]);
    expect(data.computedFor(1)).toEqual({ balance: 41 });
  });

  it("draws references with the label slot, and marks the tree's columns", () => {
    const { config } = compile(rowsClient());
    const columns = config.gridSchema.levels.accounts.columns;
    const parent = columns.find((column) => column.id === "parent_id");
    const name = columns.find((column) => column.id === "name");

    expect(lookupEntryRenderer(preset(parent!)!)).toBeTypeOf("function");
    // The own label column is wrapped: the label slot draws over the cell.
    expect(name?.renderCell).toBeTypeOf("function");
  });

  it("shows the parent path in the tree's parent picker", async () => {
    const { store, config } = compile(rowsClient(), {});
    store
      .table("accounts")
      .storeComputed({ parentPath: { "2": "Expenses > Kitchen" } }, 0);
    const parent = config.gridSchema.levels.accounts.columns.find(
      (column) => column.id === "parent_id",
    );
    const renderEntry = lookupEntryRenderer(preset(parent!)!)!;

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        renderEntry({
          entry: { value: 2, label: "Groceries" },
          surface: "option",
          density: "compact",
          defaultContent: "Groceries",
        }),
      ),
    );

    expect(container.textContent).toContain("Expenses > Kitchen");
    await act(async () => root.unmount());
  });

  it("keeps a column drawn by a slot in narrow cards when its value is empty", () => {
    const Volume = () => null;
    const { config } = compile(rowsClient(), {
      accounts: { columns: { parent_id: { render: Volume } } },
    });
    const columns = config.gridSchema.levels.accounts.columns;
    const meta = (id: string) =>
      columns.find((column) => column.id === id)?.meta as
        { cardHideWhenEmpty?: boolean } | undefined;

    expect(meta("parent_id")?.cardHideWhenEmpty).toBe(false);
  });
});
