// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PAGE_SIZE, type TableSchema } from "@sapporta/shared/contracts";
import type { TableRowsClient } from "../tgrid/tgrid-level-config";
import { defineTGrid } from "../tgrid/tgrid-runtime-config";
import {
  createTGridSession,
  type TGridRouteQuerySeed,
  type TGridSession,
} from "../tgrid/tgrid-session";
import { useTableLevelPager, type TableLevelPager } from "./table-level-pager";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type AccountRow = { id: number; name: string; parent_id: number | null };
type Rows = { accounts: AccountRow };

const accountsTable: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", kind: "number", primary: true },
    { name: "name", label: "Name", kind: "text" },
    { name: "parent_id", label: "Parent", kind: "number" },
  ],
  children: [],
  tree: {
    parentColumn: "parent_id",
    column: "name",
    defaultExpanded: true,
    matchContext: "ancestors-and-descendants",
  },
};

function rowsClient(): TableRowsClient {
  return {
    fetch: vi.fn(async () => ({
      data: [],
      meta: { total: 0, page: 1, limit: MAX_PAGE_SIZE, pages: 0 },
    })),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

const sessions: TGridSession<Rows>[] = [];
let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  for (const session of sessions.splice(0)) session.dispose();
});

function accountsSession(
  tree: false | undefined,
  seed: TGridRouteQuerySeed = {},
): TGridSession<Rows> {
  const session = createTGridSession(
    defineTGrid<Rows>({
      rootLevel: "accounts",
      levels: {
        accounts: {
          table: accountsTable,
          childLevels: [],
          rowsClient: rowsClient(),
          ...(tree === false ? { tree } : {}),
        },
      },
    }),
    { routeQuerySeeds: { accounts: seed } },
  );
  sessions.push(session);
  return session;
}

async function readPager(session: TGridSession<Rows>) {
  const read: { current: TableLevelPager | null } = { current: null };
  function Probe() {
    read.current = useTableLevelPager(session, "accounts", "/accounts");
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
  mounted = { root, container };
  return read;
}

describe("useTableLevelPager", () => {
  it("gives a tree level one page, even when rows were cut off", async () => {
    const session = accountsSession(undefined, { page: 3 });
    const state = session.queryStore.getState();
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(MAX_PAGE_SIZE);

    const pager = await readPager(session);
    await act(async () => state.setTotalCount(1500));
    expect(pager.current?.pages).toBe(1);

    await act(async () => session.queryStore.getState().setPage(2));
    expect(session.queryStore.getState().page).toBe(1);
  });

  it("pages a tree table that a level shows flat", async () => {
    const session = accountsSession(false, { page: 3 });
    expect(session.queryStore.getState().page).toBe(3);

    const pager = await readPager(session);
    await act(async () => session.queryStore.getState().setTotalCount(1500));
    expect(pager.current?.pages).toBe(30);
  });
});
