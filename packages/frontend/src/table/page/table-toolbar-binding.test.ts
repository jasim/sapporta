// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { NewFilterCondition } from "@sapporta/shared/filter";
import { StaticSearchLookup, StaticValueLookup } from "@sapporta/grid/lookup";
import type { SortDescriptor } from "@sapporta/grid";
import type { TGridTableRow } from "@/table/grid-adapter/tgrid-types";
import type { TGridLevelQueryState } from "@/table/state/tgrid-level-query-state";
import type { TGridSession } from "@/table/state/tgrid-session";
import { useTableToolbarProps } from "./table-toolbar-binding";
import type { TableToolbarProps } from "./TableToolbar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type BookRow = TGridTableRow & {
  id: number;
  title: string;
  author_id: number;
};

type RowsByLevel = {
  books: BookRow;
};

const booksTable: TableSchema = {
  name: "books",
  label: "Books",
  immutable: false,
  rowLabelColumns: ["title"],
  columns: [
    { name: "id", label: "ID", primary: true, kind: "number" },
    { name: "title", label: "Title", kind: "text" },
    {
      name: "author_id",
      label: "Author",
      kind: "number",
      foreignKey: { table: "authors", column: "id" },
    },
  ],
  children: [],
};

let mounted: { root: Root; container: HTMLElement } | null = null;

describe("useTableToolbarProps", () => {
  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
  });

  it("keeps public columns as table schema and exposes column lookup", async () => {
    const authorSearchLookup = new StaticSearchLookup([
      { value: "7", label: "Octavia Butler" },
    ]);
    const authorValueLookup = new StaticValueLookup([
      { value: "42", label: "Ursula K. Le Guin" },
    ]);
    const lookupForColumn = vi.fn(() => ({
      valueLookup: authorValueLookup,
      searchLookup: authorSearchLookup,
    }));
    const session = makeSession({ lookupForColumn });

    const captured = await renderUseTableToolbarProps(session);
    const authorColumn = booksTable.columns[2];

    expect(captured.tableName).toBe("books");
    expect(captured.columns).toBe(booksTable.columns);
    expect(
      captured.lookupForColumn?.({
        tableName: "books",
        column: authorColumn,
      }),
    ).toEqual({
      valueLookup: authorValueLookup,
      searchLookup: authorSearchLookup,
    });
    expect(lookupForColumn).toHaveBeenCalledWith({
      tableName: "books",
      column: authorColumn,
    });
  });
});

async function renderUseTableToolbarProps(
  session: TGridSession<RowsByLevel>,
): Promise<TableToolbarProps> {
  let captured: TableToolbarProps | null = null;

  function Capture(): ReactElement | null {
    captured = useTableToolbarProps({
      session,
      table: booksTable,
      totalCount: 2,
    });
    return null;
  }

  mounted = await render(createElement(Capture));
  if (!captured) throw new Error("Toolbar props were not captured");
  return captured;
}

function makeSession(args: {
  lookupForColumn: TGridSession<RowsByLevel>["lookupForColumn"];
}): TGridSession<RowsByLevel> {
  const queryStore = createStore<TGridLevelQueryState<TGridTableRow>>(() => ({
    level: "books",
    sort: [],
    filters: [],
    search: null,
    page: 1,
    pageSize: 25,
    errorBanner: null,
    setSort: (_sort: SortDescriptor[]) => {},
    clearSort: () => {},
    addFilter: (_cond: NewFilterCondition) => {},
    updateFilter: (_id: string, _patch: NewFilterCondition) => {},
    removeFilter: (_id: string) => {},
    clearFilters: () => {},
    setSearch: (_q: string | null) => {},
    setFilter: () => {},
    setPage: (_page: number) => {},
    setErrorBanner: (_msg: string | null) => {},
    syncFromUrl: () => {},
  }));

  return {
    rootLevel: "books",
    rootTableName: "books",
    levels: {
      books: { queryStore },
    },
    queryStore,
    lookupForColumn: args.lookupForColumn,
    csvExportUrl: () => "/api/tables/books/export.csv",
  } as unknown as TGridSession<RowsByLevel>;
}

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
