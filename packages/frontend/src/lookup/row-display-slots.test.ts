// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LookupResponse, TableSchema } from "@sapporta/shared/contracts";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import { createLookupStore } from "./row-data";
import {
  ColumnSlotCell,
  RowDataStoreProvider,
  useRowComputed,
} from "./row-display";
import { LookupPicker } from "./LookupPicker";
import { tableDisplay } from "./table-display";
import type { CellSlotProps, ReferenceSlotProps } from "./row-display-types";
import { compileTGridRuntimeConfig } from "../table/tgrid/tgrid-runtime-config";
import { createTGridColumnMapper } from "../table/tgrid/tgrid-column-mapper";
import { createTGridColumnsBuilder } from "../table/tgrid/tgrid-column-spec";
import type { TableRowsClient } from "../table/tgrid/tgrid-level-config";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchLookup, fetchLookupSearch } = vi.hoisted(() => ({
  fetchLookup: vi.fn(),
  fetchLookupSearch: vi.fn(),
}));

vi.mock("./api/lookup", () => ({ fetchLookup, fetchLookupSearch }));

const stocks: TableSchema = {
  name: "stocks",
  label: "Stocks",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["symbol"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "symbol", label: "Symbol", kind: "text" },
    { name: "buy", label: "Buy", kind: "number" },
    { name: "sell", label: "Sell", kind: "number" },
  ],
  children: [],
  computed: [
    { name: "buyVolume", label: "Buy volume", kind: "json" },
    { name: "sellVolume", label: "Sell volume", kind: "json" },
  ],
};

const accounts: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "name", label: "Name", kind: "text" },
  ],
  children: [],
  computed: [{ name: "parentPath", label: "Parent path", kind: "text" }],
  rowCaption: "parentPath",
};

function computedResponse(
  field: string,
  ids: readonly (string | number)[],
  value: (id: string) => unknown,
): LookupResponse {
  return {
    entries: [],
    computed: {
      [field]: Object.fromEntries(
        ids.map((id) => [String(id), value(String(id))]),
      ) as Record<string, never>,
    },
  };
}

let mounted: { root: Root; container: HTMLElement } | null = null;

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element));
  return container;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  fetchLookup.mockReset();
  fetchLookupSearch.mockReset();
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  document.body.replaceChildren();
});

describe("column slots", () => {
  it("ask a level only for the needs of its visible columns", () => {
    const Spark = () => null;
    const store = createLookupStore({
      tables: () => [stocks],
      rowDisplays: {
        stocks: {
          columns: {
            buy: { needs: ["buyVolume"], render: Spark },
            sell: { needs: ["sellVolume"], render: Spark },
          },
        },
      },
    });
    const fetch = vi.fn(async (_params: unknown) => ({
      data: [],
      meta: { total: 0, page: 1, limit: 50, pages: 0 },
    }));
    const columns = createTGridColumnsBuilder<
      { stocks: Record<string, unknown> },
      unknown,
      "stocks"
    >("stocks");
    const config = compileTGridRuntimeConfig<{
      stocks: Record<string, unknown>;
    }>({
      rootLevel: "stocks",
      levels: {
        stocks: {
          table: stocks,
          childLevels: [],
          query: { owner: "source" },
          rowsClient: { fetch } as unknown as TableRowsClient,
          columns: [columns.table("symbol"), columns.table("buy")],
        },
      },
      columnMapper: createTGridColumnMapper({ lookups: store, rowData: store }),
      rowData: store,
    });
    const endpoint = config.endpointFactoriesByLevel.stocks({ ancestors: [] });

    void endpoint.fetchPage(
      (endpoint.buildRowsRequest ?? ((q) => q))(endpoint.rowQuery.current()),
    );

    expect(fetch.mock.calls[0]?.[0]).toMatchObject({ computed: ["buyVolume"] });
  });

  it("draw the default cell until their needs arrive", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchLookup.mockImplementation(async (_table, ids: string[]) => {
      await held;
      return computedResponse("buyVolume", ids, () => [1, 2, 3]);
    });
    const store = createLookupStore({ tables: () => [stocks] });
    function Spark({ computed, defaultContent }: CellSlotProps) {
      return createElement(
        "span",
        null,
        defaultContent,
        ` ~${(computed.buyVolume as number[]).join("")}`,
      );
    }

    const container = await render(
      createElement(ColumnSlotCell, {
        data: store.table("stocks"),
        slot: { needs: ["buyVolume"], render: Spark },
        id: 7,
        value: 120,
        row: { id: 7, buy: 120 },
        defaultContent: "120",
        context: {
          as: "self",
          surface: "cell",
          density: "compact",
          hierarchyShown: false,
        },
      }),
    );
    expect(container.textContent).toBe("120");

    release();
    await settle();
    expect(fetchLookup).toHaveBeenCalledWith("stocks", ["7"], ["buyVolume"]);
    expect(container.textContent).toBe("120 ~123");
  });

  it("give a foreign-key slot the referenced row and its referenceNeeds", async () => {
    fetchLookup.mockImplementation(async (_table, ids: string[]) => ({
      entries: ids.map((id) => ({
        value: Number(id),
        label: "Groceries",
        meta: {},
      })),
      computed: {
        parentPath: Object.fromEntries(ids.map((id) => [id, "Expenses"])),
      },
    }));
    const store = createLookupStore({ tables: () => [accounts] });
    await store.table("accounts").valueLookup.loadMissingEntries([3]);
    function Ref({ reference }: ReferenceSlotProps) {
      return createElement(
        "span",
        null,
        reference
          ? `${reference.label} in ${String(reference.computed.parentPath)}`
          : "-",
      );
    }

    const container = await render(
      createElement(ColumnSlotCell, {
        data: store.table("entries"),
        slot: { referenceNeeds: ["parentPath"], render: Ref },
        id: 1,
        value: 3,
        row: { id: 1, account_id: 3 },
        defaultContent: "Groceries",
        reference: store.table("accounts"),
        context: {
          as: "self",
          surface: "cell",
          density: "compact",
          hierarchyShown: false,
        },
      }),
    );
    await settle();

    expect(container.textContent).toBe("Groceries in Expenses");
  });
});

describe("useRowComputed", () => {
  it("returns the named fields once they are known", async () => {
    fetchLookup.mockImplementation(async (_table, ids: string[]) =>
      computedResponse("onHand", ids, (id) => Number(id) * 2),
    );
    const store = createLookupStore();
    const seen: unknown[] = [];
    function Probe({ id }: { id: number }) {
      seen.push(useRowComputed("items", id, ["onHand"]));
      return null;
    }

    await render(
      createElement(
        RowDataStoreProvider,
        { store },
        createElement(Probe, { id: 4 }),
        createElement(Probe, { id: 5 }),
      ),
    );
    await settle();

    expect(fetchLookup).toHaveBeenCalledTimes(1);
    expect(fetchLookup).toHaveBeenCalledWith("items", ["4", "5"], ["onHand"]);
    expect(seen.at(-1)).toEqual({ onHand: 10 });
    expect(seen[0]).toBeUndefined();
  });
});

describe("LookupPicker with a table's row data", () => {
  it("draws the caption under options and beside the chosen value", async () => {
    fetchLookup.mockImplementation(async (_table, ids: number[]) => ({
      entries: ids.map((id) => ({
        value: id,
        label: `Account ${id}`,
        meta: {},
      })),
      computed: {
        parentPath: Object.fromEntries(
          ids.map((id) => [String(id), "Expenses > Kitchen"]),
        ),
      },
    }));
    fetchLookupSearch.mockResolvedValue({ entries: [] });
    const store = createLookupStore({ tables: () => [accounts] });

    await render(
      createElement(LookupPicker, {
        lookup: store.table("accounts"),
        value: 9,
        onChange: () => undefined,
      }),
    );
    await settle();

    const adornment = document.querySelector(
      "[data-lookup-selected-adornment]",
    );
    expect(adornment?.textContent).toBe("Expenses > Kitchen");
    expect(fetchLookup).toHaveBeenCalledWith("accounts", [9], ["parentPath"]);
  });

  it("keeps the caption beside the chosen value with a custom item", async () => {
    mockAccountLookups();
    const store = createLookupStore({ tables: () => [accounts] });

    await render(
      createElement(LookupPicker<number, Record<string, unknown>>, {
        lookup: store.table("accounts") as LookupCapabilities<
          number,
          Record<string, unknown>
        >,
        value: 9,
        onChange: () => undefined,
        itemDisplay: {
          fields: [],
          component: ({ defaultContent }) =>
            createElement("span", { "data-custom-item": "" }, defaultContent),
        },
      }),
    );
    await settle();

    expect(
      document.querySelector("[data-lookup-selected-adornment]")?.textContent,
    ).toBe("Expenses > Kitchen");
  });

  it("draws the caption on its own line with selectedCaption below", async () => {
    mockAccountLookups();
    const store = createLookupStore({ tables: () => [accounts] });

    const empty = await render(
      createElement(LookupPicker, {
        lookup: store.table("accounts"),
        value: null,
        onChange: () => undefined,
        selectedCaption: "below",
      }),
    );
    await settle();
    // The line is there before a value is chosen, so picking one moves nothing.
    expect(
      empty.querySelector("[data-lookup-selected-caption]")?.textContent,
    ).toBe("");

    const chosen = await render(
      createElement(LookupPicker, {
        lookup: store.table("accounts"),
        value: 9,
        onChange: () => undefined,
        selectedCaption: "below",
      }),
    );
    await settle();

    expect(
      chosen.querySelector("[data-lookup-selected-caption]")?.textContent,
    ).toBe("Expenses > Kitchen");
    expect(chosen.querySelector("[data-lookup-selected-adornment]")).toBe(null);
  });
});

function mockAccountLookups() {
  fetchLookup.mockImplementation(async (_table, ids: number[]) => ({
    entries: ids.map((id) => ({
      value: id,
      label: `Account ${id}`,
      meta: {},
    })),
    computed: {
      parentPath: Object.fromEntries(
        ids.map((id) => [String(id), "Expenses > Kitchen"]),
      ),
    },
  }));
  fetchLookupSearch.mockResolvedValue({ entries: [] });
}
