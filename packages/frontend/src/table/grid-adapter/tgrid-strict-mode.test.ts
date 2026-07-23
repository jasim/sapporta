// @vitest-environment happy-dom

import { StrictMode, act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import { TGrid } from "../page/TGrid";
import { TablePage } from "../page/TablePage";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { defineTGrid } from "./tgrid-runtime-config";
import { useTGridSession } from "./tgrid-binding";
import type { TableRowsClient } from "./tgrid-level-config";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/rows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/rows")>();
  return {
    ...actual,
    fetchTableRows: vi.fn(async () => ({
      data: [{ id: "1", customer: "Acme" }],
      meta: { total: 1, page: 1, limit: 50, pages: 1 },
    })),
  };
});

type RowsByLevel = {
  orders: { id: string; customer: string };
};

const ordersTable: TableSchema = {
  name: "orders",
  label: "Orders",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["customer"],
  columns: [
    { name: "id", label: "ID", kind: "text", primary: true },
    { name: "customer", label: "Customer", kind: "text" },
  ],
  children: [],
};

const rowsClient: TableRowsClient = {
  fetch: vi.fn(async () => ({
    data: [{ id: "1", customer: "Acme" }],
    meta: { total: 1, page: 1, limit: 50, pages: 1 },
  })),
  create: vi.fn(async (_table, data) => ({ data })),
  update: vi.fn(async (_table, _id, data) => ({ data })),
  remove: vi.fn(async (_table, id) => ({ data: { id } })),
};

const definition = defineTGrid<RowsByLevel>({
  rootLevel: "orders",
  levels: {
    orders: {
      table: ordersTable,
      childLevels: [],
      query: { owner: "host" },
      rowsClient,
    },
  },
});

function definitionWithCustomer(customer: string) {
  const replacementRowsClient: TableRowsClient = {
    fetch: vi.fn(async () => ({
      data: [{ id: "1", customer }],
      meta: { total: 1, page: 1, limit: 50, pages: 1 },
    })),
    create: vi.fn(async (_table, data) => ({ data })),
    update: vi.fn(async (_table, _id, data) => ({ data })),
    remove: vi.fn(async (_table, id) => ({ data: { id } })),
  };

  return defineTGrid<RowsByLevel>({
    rootLevel: "orders",
    levels: {
      orders: {
        table: ordersTable,
        childLevels: [],
        query: { owner: "host" },
        rowsClient: replacementRowsClient,
      },
    },
  });
}

function CustomGridView() {
  const session = useTGridSession(definition, {
    routeQuerySeeds: {
      orders: {
        sort: [{ colId: "customer", direction: "asc" }],
      },
    },
  });

  if (!session) return createElement("div", null, "loading");

  session.runtime.root.data.state();

  return createElement(TGrid<RowsByLevel>, { session });
}

function ReplaceableGridView({
  definition,
}: {
  definition: ReturnType<typeof definitionWithCustomer>;
}) {
  const session = useTGridSession(definition);

  if (!session) return createElement("div", null, "loading");

  session.runtime.root.data.state();

  return createElement(TGrid<RowsByLevel>, { session });
}

async function renderStrict(element: ReactElement): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(StrictMode, null, element));
  });
  return { container, root };
}

async function renderClient(
  element: ReactElement,
  options: { strict?: boolean } = {},
): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      options.strict ? createElement(StrictMode, null, element) : element,
    );
  });
  return { container, root };
}

async function rerenderClient(
  root: Root,
  element: ReactElement,
  options: { strict?: boolean } = {},
): Promise<void> {
  await act(async () => {
    root.render(
      options.strict ? createElement(StrictMode, null, element) : element,
    );
  });
}

async function waitForText(
  container: HTMLElement,
  text: string,
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (container.textContent?.includes(text)) return;
  }
  throw new Error(
    `Expected rendered text "${text}", got "${container.textContent}"`,
  );
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

function hasDisposedRuntimeError(
  calls: Parameters<typeof console.error>[],
): boolean {
  return calls.some((call) =>
    call.some((arg) => String(arg).includes("GridRuntime has been disposed")),
  );
}

describe("TGrid StrictMode lifecycle", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
    useSchemaStore.getState().reset();
    vi.clearAllMocks();
  });

  it("keeps a custom hook-owned session live after StrictMode remount", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      mounted = await renderStrict(createElement(CustomGridView));

      await waitForText(mounted.container, "Acme");

      expect(mounted.container.textContent).not.toContain("loading");
      expect(hasDisposedRuntimeError(consoleError.mock.calls)).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps TablePage subscribed to the current StrictMode session", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    useSchemaStore.getState().setTables([ordersTable]);

    try {
      mounted = await renderStrict(
        createElement(
          MemoryRouter,
          { initialEntries: ["/tables/orders?sort=customer"] },
          createElement(TablePage, { tableName: "orders" }),
        ),
      );

      await waitForText(mounted.container, "Acme");

      expect(hasDisposedRuntimeError(consoleError.mock.calls)).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each([
    { strict: false, mode: "ordinary" },
    { strict: true, mode: "StrictMode" },
  ])(
    "replaces a hook-owned session on $mode definition replacement",
    async ({ strict }) => {
      const definitionA = definitionWithCustomer("Acme");
      const definitionB = definitionWithCustomer("Beta");
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      try {
        mounted = await renderClient(
          createElement(ReplaceableGridView, { definition: definitionA }),
          { strict },
        );

        await waitForText(mounted.container, "Acme");
        await rerenderClient(
          mounted.root,
          createElement(ReplaceableGridView, { definition: definitionB }),
          { strict },
        );
        await waitForText(mounted.container, "Beta");

        expect(mounted.container.textContent).toContain("Beta");
        expect(mounted.container.textContent).not.toContain("Acme");
        expect(hasDisposedRuntimeError(consoleError.mock.calls)).toBe(false);
      } finally {
        consoleError.mockRestore();
      }
    },
  );
});
