// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupResponse, TableSchema } from "@sapporta/shared/contracts";
import { createLookupStore } from "./row-data";
import {
  referenceEntryRenderer,
  RowDisplayProvider,
  useRowDisplays,
} from "./row-display";
import type { LabelSlotProps, RowDisplays } from "./row-display-types";
import { checkRowDisplays, mergeRowDisplays } from "./row-display-types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchLookup, fetchLookupSearch } = vi.hoisted(() => ({
  fetchLookup: vi.fn(),
  fetchLookupSearch: vi.fn(),
}));

vi.mock("./api/lookup", () => ({ fetchLookup, fetchLookupSearch }));

const accounts: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  columns: [
    { name: "id", label: "Id", kind: "number", primary: true },
    { name: "name", label: "Name", kind: "text" },
  ],
  children: [],
  rowLabelColumns: ["name"],
  searchable: true,
  computed: [
    { name: "parentPath", label: "Parent path", kind: "text" },
    { name: "balance", label: "Balance", kind: "number" },
  ],
  rowCaption: "parentPath",
};

function pathsFor(
  ids: readonly (string | number)[],
  prefix = "P",
): LookupResponse {
  return {
    entries: ids.map((id) => ({
      value: Number(id),
      label: `A${id}`,
      meta: {},
    })),
    computed: {
      parentPath: Object.fromEntries(
        ids.map((id) => [String(id), prefix === "P" ? `P${id}` : prefix]),
      ),
    },
  };
}

beforeEach(() => {
  fetchLookup.mockReset();
  fetchLookupSearch.mockReset();
});

describe("row data store", () => {
  it("asks for computed fields in one batched lookup per tick", async () => {
    fetchLookup.mockImplementation(async (_table, ids: string[]) =>
      pathsFor(ids),
    );
    const store = createLookupStore({ tables: () => [accounts] });
    const data = store.table("accounts");

    await Promise.all([
      data.ensureComputed([1, 2], ["parentPath"]),
      data.ensureComputed([2, 3], ["parentPath"]),
    ]);

    expect(fetchLookup).toHaveBeenCalledTimes(1);
    expect(fetchLookup).toHaveBeenCalledWith(
      "accounts",
      ["1", "2", "3"],
      ["parentPath"],
    );
    expect(data.computedFor(3)).toEqual({ parentPath: "P3" });

    await data.ensureComputed([1, 2, 3], ["parentPath"]);
    expect(fetchLookup).toHaveBeenCalledTimes(1);
  });

  it("keeps values drawn after invalidation, and reads them again", async () => {
    fetchLookup.mockImplementation(async (_table, ids: string[]) =>
      pathsFor(ids),
    );
    const store = createLookupStore({ tables: () => [accounts] });
    const data = store.table("accounts");
    await data.ensureComputed([1], ["parentPath"]);
    const before = data.generation;

    store.invalidateComputed();

    expect(data.generation).toBe(before + 1);
    expect(data.computedFor(1)).toEqual({ parentPath: "P1" });
    await data.ensureComputed([1], ["parentPath"]);
    expect(fetchLookup).toHaveBeenCalledTimes(2);
  });

  it("reads a value again when the read was sent before an invalidation", async () => {
    let finishOld: (() => void) | undefined;
    fetchLookup
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => (finishOld = resolve));
        return pathsFor(["1"], "Old");
      })
      .mockImplementationOnce(async () => pathsFor(["1"], "New"));
    const store = createLookupStore({ tables: () => [accounts] });
    const data = store.table("accounts");
    const old = data.ensureComputed([1], ["parentPath"]);
    await Promise.resolve();

    store.invalidateComputed();
    const fresh = data.ensureComputed([1], ["parentPath"]);
    finishOld?.();
    await Promise.all([old, fresh]);

    expect(fetchLookup).toHaveBeenCalledTimes(2);
    expect(data.computedFor(1)).toEqual({ parentPath: "New" });
  });

  it("does not ask again for a field a read could not return", async () => {
    fetchLookup.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createLookupStore({ tables: () => [accounts] });
    const data = store.table("accounts");

    await data.ensureComputed([1], ["parentPath"]);
    await data.ensureComputed([1], ["parentPath"]);

    expect(fetchLookup).toHaveBeenCalledTimes(1);
    expect(data.computedFor(1)).toBeUndefined();
    error.mockRestore();
  });

  it("sends the caption and the label slot's needs with every lookup", async () => {
    fetchLookup.mockImplementation(async (_table, ids: string[]) =>
      pathsFor(ids),
    );
    const store = createLookupStore({
      tables: () => [accounts],
      rowDisplays: { accounts: { label: { needs: ["balance"] } } },
    });
    const data = store.table("accounts");

    await data.valueLookup.loadMissingEntries([4]);

    expect(fetchLookup).toHaveBeenCalledWith(
      "accounts",
      [4],
      ["balance", "parentPath"],
    );
    expect(data.computedFor(4)).toEqual({ parentPath: "P4" });
  });
});

describe("row labels", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await act(async () => mounted?.root.unmount());
      mounted.container.remove();
      mounted = null;
    }
  });

  async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };
    await act(async () => root.render(element));
    return container;
  }

  it("draws the caption under an option, but not in a compact cell", async () => {
    const store = createLookupStore({ tables: () => [accounts] });
    store
      .table("accounts")
      .storeComputed({ parentPath: { "7": "Expenses > Kitchen" } }, 0);
    const renderEntry = referenceEntryRenderer({
      data: store.table("accounts"),
      source: { table: "entries", column: "account_id" },
      hierarchyShown: false,
    });
    const entry = { value: 7, label: "Groceries" };

    const container = await render(
      createElement(
        "div",
        null,
        createElement(
          "p",
          { id: "option" },
          renderEntry({
            entry,
            surface: "option",
            density: "compact",
            defaultContent: "Groceries",
          }),
        ),
        createElement(
          "p",
          { id: "cell" },
          renderEntry({
            entry,
            surface: "cell",
            density: "compact",
            defaultContent: "Groceries",
          }),
        ),
      ),
    );

    expect(container.querySelector("#option")?.textContent).toBe(
      "GroceriesExpenses > Kitchen",
    );
    expect(container.querySelector("#cell")?.textContent).toBe("Groceries");
  });

  it("draws a label slot once its needs are known", async () => {
    fetchLookup.mockImplementation(async (_table, ids: string[]) => ({
      entries: [],
      computed: { balance: Object.fromEntries(ids.map((id) => [id, 12])) },
    }));
    function WithBalance({ label, computed }: LabelSlotProps) {
      return createElement("b", null, `${label} (${String(computed.balance)})`);
    }
    const store = createLookupStore({
      tables: () => [accounts],
      rowDisplays: {
        accounts: {
          label: {
            needs: ["balance"],
            render: WithBalance,
          },
        },
      },
    });
    const renderEntry = referenceEntryRenderer({
      data: store.table("accounts"),
      source: { table: "entries" },
      hierarchyShown: true,
    });

    const container = await render(
      createElement(
        "p",
        null,
        renderEntry({
          entry: { value: 3, label: "Cash" },
          surface: "cell",
          density: "compact",
          defaultContent: "Cash",
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchLookup).toHaveBeenCalledWith("accounts", ["3"], ["balance"]);
    expect(container.textContent).toBe("Cash (12)");
  });
});

describe("row display providers", () => {
  it("merge by table, then by slot", () => {
    const Label = () => null;
    const outer: RowDisplays = {
      items: {
        label: { render: Label },
        columns: { price: { needs: ["trend"] } },
      },
    };
    const merged = mergeRowDisplays(outer, {
      items: { columns: { stock: { needs: ["onHand"] } } },
    });
    expect(merged.items?.label?.render).toBe(Label);
    expect(Object.keys(merged.items?.columns ?? {})).toEqual([
      "price",
      "stock",
    ]);
  });

  it("nest in React", async () => {
    let seen: RowDisplays = {};
    function Probe() {
      seen = useRowDisplays();
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          RowDisplayProvider,
          { displays: { a: { label: { needs: ["x"] } } } },
          createElement(
            RowDisplayProvider,
            { displays: { b: { label: { needs: ["y"] } } } },
            createElement(Probe),
          ),
        ),
      ),
    );
    expect(Object.keys(seen)).toEqual(["a", "b"]);
    await act(async () => root.unmount());
  });

  it("reject names the schema does not have", () => {
    expect(() =>
      checkRowDisplays({ accounts: { label: { needs: ["nope"] } } }, [
        accounts,
      ]),
    ).toThrow("needs 'nope', which is not a computed field of 'accounts'");
    expect(() =>
      checkRowDisplays({ accounts: { columns: { nope: {} } } }, [accounts]),
    ).toThrow("there is no column 'nope'");
  });
});
