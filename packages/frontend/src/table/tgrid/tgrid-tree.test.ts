import { describe, expect, it, vi } from "vitest";
import {
  MAX_PAGE_SIZE,
  type PaginatedRows,
  type TableSchema,
} from "@sapporta/shared/contracts";
import { eqCondition, parseFiltersForTable } from "@sapporta/shared/filter";
import type {
  FetchPageRequest,
  RestEndpointFactory,
  RowQueryState,
} from "@sapporta/grid";
import {
  StaticSearchLookup,
  StaticValueLookup,
  type LookupCapabilities,
} from "@sapporta/grid/lookup";
import type { LookupStore } from "../../lookup";
import { createTGridColumnMapper } from "./tgrid-column-mapper";
import type { TGridFilter } from "./tgrid-filter";
import type { TableRowsClient, TGridLevelConfig } from "./tgrid-level-config";
import type { TGridTreeResult } from "./tgrid-level-query-state";
import { compileTGridRuntimeConfig, defineTGrid } from "./tgrid-runtime-config";
import { buildSchemaTGridConfig } from "./schema-tgrid";

type AccountRow = { id: number; name: string; parent_id: number | null };
type EntryRow = { id: number; account_id: number };
type Rows = { accounts: AccountRow };

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
  children: [
    {
      table: "entries",
      foreignKey: "account_id",
      label: "Entries",
      columns: [],
      defaultSort: "id",
    },
  ],
  tree: {
    parentColumn: "parent_id",
    column: "name",
    defaultExpanded: true,
    matchContext: "ancestors-and-descendants",
  },
};

const flatAccounts: TableSchema = { ...accounts, tree: undefined };

const entries: TableSchema = {
  name: "entries",
  label: "Entries",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["id"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "account_id", label: "Account", kind: "number" },
  ],
  children: [],
};

function emptyLookupStore(): LookupStore {
  const lookup: LookupCapabilities = {
    valueLookup: new StaticValueLookup([]),
    searchLookup: new StaticSearchLookup([]),
  };
  return {
    table: () => lookup,
    foreignKey: () => undefined,
    requireForeignKey: () => lookup,
    clear: () => undefined,
  };
}

function hostQuery(seed: {
  page?: number;
  search?: string | null;
  filters?: TGridFilter["conditions"];
}): RowQueryState<TGridFilter> {
  const state = {
    page: seed.page ?? 1,
    pageSize: 50,
    sort: [],
    filter: { conditions: seed.filters ?? [], search: seed.search ?? null },
  };
  return {
    current: () => state,
    setSortState: () => "unchanged",
    setFilterState: () => "unchanged",
    setPageState: () => "unchanged",
  };
}

function compile(
  level: Partial<TGridLevelConfig<Rows>> = {},
  options: {
    query?: RowQueryState<TGridFilter>;
    fetch?: TableRowsClient["fetch"];
    recordTreeResult?: (levelId: string, result: TGridTreeResult) => void;
  } = {},
) {
  const fetch =
    options.fetch ??
    vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 1, limit: MAX_PAGE_SIZE, pages: 0 },
    }));
  return compileTGridRuntimeConfig<Rows>({
    rootLevel: "accounts",
    levels: {
      accounts: {
        table: accounts,
        childLevels: [],
        query: { owner: "host" },
        rowsClient: {
          fetch,
          create: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
        },
        ...level,
      },
    },
    columnMapper: createTGridColumnMapper({ lookups: emptyLookupStore() }),
    hostRowQueryState: () => options.query ?? hostQuery({}),
    recordTreeResult: options.recordTreeResult,
  });
}

function request(
  endpoint: ReturnType<RestEndpointFactory<TGridFilter>>,
): FetchPageRequest<TGridFilter> {
  const build = endpoint.buildRowsRequest ?? ((query) => query);
  return build(endpoint.rowQuery.current());
}

describe("TGrid tree levels", () => {
  it("compiles the table's tree into the grid level", () => {
    const compiled = compile();
    const level = compiled.gridSchema.levels.accounts;
    expect(level.tree).toMatchObject({
      parentKeyField: "parent_id",
      defaultExpanded: true,
    });
    // A child draft stores the parent's primary key as the table types it.
    expect(
      level.tree?.parentKeyValue?.({
        rowKey: "7",
        levelName: "accounts",
        columns: { id: 7, name: "Income", parent_id: null },
      }),
    ).toBe(7);
    expect(compiled.levelInfoById.accounts.pagination).toBe("all");
    const name = level.columns.find((column) => column.id === "name");
    expect(name?.activation?.startsOn).toEqual(["enter", "space"]);
    expect(compiled.levelInfoById.accounts.tree?.column).toBe("name");
    expect(level.childLevels).toEqual([]);
  });

  it("lets a level show a tree table flat or override its fields", () => {
    const flat = compile({ tree: false });
    expect(flat.gridSchema.levels.accounts.tree).toBe(undefined);
    expect(flat.levelInfoById.accounts.pagination).toBe("pages");
    const overridden = compile({
      tree: { column: "id", defaultExpanded: false },
    });
    expect(overridden.gridSchema.levels.accounts.tree).toMatchObject({
      parentKeyField: "parent_id",
      defaultExpanded: false,
    });
    expect(overridden.levelInfoById.accounts.tree?.column).toBe("id");
    const optedIn = compile({
      table: flatAccounts,
      tree: { parentColumn: "parent_id" },
    });
    expect(optedIn.gridSchema.levels.accounts.tree).toMatchObject({
      parentKeyField: "parent_id",
    });
    expect(optedIn.levelInfoById.accounts.tree?.column).toBe("name");
  });

  it("falls back to the card title when the tree column is not shown", () => {
    const compiled = compile({
      includedColumnNames: ["id", "name"],
      tree: { column: "parent_id" },
    });
    const name = compiled.gridSchema.levels.accounts.columns.find(
      (column) => column.id === "name",
    );
    expect(name?.activation?.startsOn).toEqual(["enter", "space"]);
    expect(compiled.levelInfoById.accounts.tree?.column).toBe("name");
  });

  it("rejects invalid tree levels", () => {
    expect(() =>
      compile({ table: flatAccounts, tree: { column: "name" } }),
    ).toThrow(/tree needs a parentColumn/);
    expect(() =>
      defineTGrid<{ accounts: AccountRow; entries: EntryRow }>({
        rootLevel: "accounts",
        levels: {
          accounts: { table: accounts, childLevels: ["entries"] },
          entries: {
            table: entries,
            parent: { level: "accounts", foreignKey: "account_id" },
            childLevels: [],
          },
        },
      }),
    ).toThrow(
      'defineTGrid: tree level "accounts" cannot also declare child levels (entries)',
    );
  });

  it("loads the whole tree whatever page the query names", async () => {
    const fetch = vi.fn(async () => ({
      data: [{ id: 1, name: "Assets", parent_id: null }],
      meta: { total: 1, page: 1, limit: MAX_PAGE_SIZE, pages: 1 },
    }));
    const endpoint = compile(
      {},
      { fetch, query: hostQuery({ page: 3 }) },
    ).endpointFactoriesByLevel.accounts({ ancestors: [] });
    await endpoint.fetchPage(request(endpoint));
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: MAX_PAGE_SIZE }),
    );
  });

  it("asks the server for matches in context while searching", async () => {
    const fetch = vi.fn(async (): Promise<PaginatedRows> => ({
      data: [
        { id: 4, name: "Expenses", parent_id: null },
        { id: 5, name: "Taxes", parent_id: 4 },
      ],
      meta: {
        total: 2,
        page: 1,
        limit: MAX_PAGE_SIZE,
        pages: 1,
        tree: { matchCount: 1, contextIds: ["4"] },
      },
    }));
    const recordTreeResult = vi.fn();
    const endpoint = compile(
      {},
      { fetch, query: hostQuery({ search: "tax" }), recordTreeResult },
    ).endpointFactoriesByLevel.accounts({ ancestors: [] });
    const response = await endpoint.fetchPage(request(endpoint));
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "tax",
        tree: "ancestors-and-descendants",
      }),
    );
    expect(response.treeContextRowKeys).toEqual(["4"]);
    expect(recordTreeResult).toHaveBeenCalledWith("accounts", {
      matchCount: 1,
      loadedRowCount: 2,
      truncated: false,
    });
  });

  it("sends fixed filters as the fixed conditions of the tree walk", async () => {
    const fetch = vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 1, limit: MAX_PAGE_SIZE, pages: 0 },
    }));
    const fixed = eqCondition("name", "Assets");
    const [typedFixed] = parseFiltersForTable([fixed], accounts);
    const endpoint = compile(
      { query: { owner: "host", fixedFilters: [fixed] } },
      { fetch, query: hostQuery({ search: "tax" }) },
    ).endpointFactoriesByLevel.accounts({ ancestors: [] });
    await endpoint.fetchPage(request(endpoint));
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        fixed: [typedFixed],
        filters: [],
        search: "tax",
        tree: "ancestors-and-descendants",
      }),
    );
  });

  it("reports a tree cut off by the row limit", async () => {
    const recordTreeResult = vi.fn();
    const fetch = vi.fn(async () => ({
      data: [{ id: 1, name: "Assets", parent_id: null }],
      meta: { total: 1500, page: 1, limit: MAX_PAGE_SIZE, pages: 2 },
    }));
    const endpoint = compile(
      {},
      { fetch, recordTreeResult },
    ).endpointFactoriesByLevel.accounts({ ancestors: [] });
    await endpoint.fetchPage(request(endpoint));
    expect(recordTreeResult).toHaveBeenCalledWith("accounts", {
      matchCount: null,
      loadedRowCount: 1,
      truncated: true,
    });
  });

  it("does not ask the server to walk a tree the table does not declare", async () => {
    const fetch = vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 1, limit: MAX_PAGE_SIZE, pages: 0 },
    }));
    const endpoint = compile(
      { table: flatAccounts, tree: { parentColumn: "parent_id" } },
      { fetch, query: hostQuery({ search: "tax" }) },
    ).endpointFactoriesByLevel.accounts({ ancestors: [] });
    await endpoint.fetchPage(request(endpoint));
    expect(fetch).toHaveBeenCalledWith(
      expect.not.objectContaining({ tree: expect.anything() }),
    );
  });

  it("builds no child levels for a tree table on schema pages", () => {
    const config = buildSchemaTGridConfig({
      source: {
        rootTableName: "accounts",
        tablesByName: {
          accounts,
          entries: {
            ...flatAccounts,
            name: "entries",
            children: [],
          },
        },
      },
    });
    expect(Object.keys(config.levels)).toEqual(["accounts"]);
    expect(config.levels.accounts.childLevels).toEqual([]);
  });
});
