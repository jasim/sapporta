// @vitest-environment happy-dom

import {
  act,
  createElement,
  createRef,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TGridDefinition } from "../grid-adapter/tgrid-runtime-config";
import type { TGridSession } from "../state/tgrid-session";
import { TableGridView } from "./TableGridView";

type RowsByLevel = {
  orders: {
    id: string;
  };
};

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    current: null as unknown,
  },
}));

vi.mock("../grid-adapter/tgrid-binding", () => ({
  useTGridSession: () => sessionState.current,
}));

vi.mock("./table-grid-url-state", () => ({
  useTableGridUrlState: () => ({
    routeQuerySeeds: {},
    onQueryUrlChange: vi.fn(),
    syncSessionFromUrl: vi.fn(),
    level: "orders",
    routePath: "/orders",
  }),
}));

vi.mock("./tgrid-lifecycle", () => ({
  useTGridLifecycle: () => undefined,
}));

vi.mock("./tgrid-source-status", () => ({
  tableLoadErrorMessage: () => null,
  useTGridSourceStatus: () => ({ status: "loaded" }),
}));

vi.mock("./table-view-pref", () => ({
  useTableViewPreference: () => ({
    preference: "table",
    setPreference: vi.fn(),
  }),
}));

vi.mock("./table-page-mode", () => ({
  resolveTableGridPresentation: () => ({ kind: "table" }),
  useTablePageMode: () => ({
    ref: { current: null },
    mode: "desktop",
  }),
}));

vi.mock("./table-grid-pager-boundary", () => ({
  createTableGridPagerBoundaryController: () => ({
    onLoadedRowsBoundary: vi.fn(),
    onPagerButtonActivate: vi.fn(),
    onPagerBoundaryExit: vi.fn(),
  }),
}));

vi.mock("zustand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("zustand")>()),
  useStore: () => null,
}));

vi.mock("./TableGridSurface", () => ({
  TableGridSurface: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("./TableGridHeader", () => ({
  TableGridHeader: () => null,
}));

vi.mock("./TableGridPager", () => ({
  TableGridPager: () => null,
}));

vi.mock("./TGrid", () => ({
  TGrid: () => null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const table: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["id"],
  columns: [{ name: "id", label: "ID", primary: true, kind: "text" }],
  children: [],
};

const definition = {
  rootLevel: "orders",
} as unknown as TGridDefinition<RowsByLevel>;

const route = {
  path: "/orders",
  searchParams: new URLSearchParams(),
  navigate: vi.fn(),
};

function view(sessionRef: Ref<TGridSession<RowsByLevel>>): ReactElement {
  return createElement(TableGridView<RowsByLevel>, {
    definition,
    table,
    route,
    sessionRef,
  });
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

async function rerender(root: Root, element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

let mounted: { root: Root; container: HTMLElement } | null = null;

describe("TableGridView sessionRef", () => {
  afterEach(async () => {
    sessionState.current = null;
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
  });

  it("attaches only after a session exists and detaches replaced sessions", async () => {
    const sessionRef = vi.fn();
    const firstSession = {
      queryStore: {},
    } as unknown as TGridSession<RowsByLevel>;
    const secondSession = {
      queryStore: {},
    } as unknown as TGridSession<RowsByLevel>;

    mounted = await render(view(sessionRef));
    expect(sessionRef).not.toHaveBeenCalled();

    sessionState.current = firstSession;
    await rerender(mounted.root, view(sessionRef));
    expect(sessionRef.mock.calls).toEqual([[firstSession]]);

    sessionState.current = secondSession;
    await rerender(mounted.root, view(sessionRef));
    expect(sessionRef.mock.calls).toEqual([
      [firstSession],
      [null],
      [secondSession],
    ]);

    sessionState.current = null;
    await rerender(mounted.root, view(sessionRef));
    expect(sessionRef.mock.calls).toEqual([
      [firstSession],
      [null],
      [secondSession],
      [null],
    ]);
  });

  it("updates and clears an object ref", async () => {
    const sessionRef = createRef<TGridSession<RowsByLevel>>();
    const session = {
      queryStore: {},
    } as unknown as TGridSession<RowsByLevel>;
    sessionState.current = session;

    mounted = await render(view(sessionRef));
    expect(sessionRef.current).toBe(session);

    await unmount(mounted.root, mounted.container);
    mounted = null;
    expect(sessionRef.current).toBeNull();
  });
});
