// @vitest-environment happy-dom

import {
  act,
  createElement,
  type ComponentType,
  type ReactElement,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TableGridActionsProps } from "../../index";
import type { TGridSession } from "../state/tgrid-session";
import { TableGridHeader } from "./TableGridHeader";
import type { TableLevelQuery } from "./table-level-query";
import type { TableSelection } from "./table-selection";
import type { TGridSourceStatus } from "./tgrid-source-status";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const hookMocks = vi.hoisted(() => ({
  useTableLevelQuery: vi.fn<() => TableLevelQuery>(),
  useTableSelection: vi.fn<() => TableSelection>(),
  useTGridSourceStatus: vi.fn<() => TGridSourceStatus>(),
}));

vi.mock("./table-level-query", () => ({
  useTableLevelQuery: hookMocks.useTableLevelQuery,
}));

vi.mock("./table-selection", () => ({
  useTableSelection: hookMocks.useTableSelection,
}));

vi.mock("./tgrid-source-status", () => ({
  useTGridSourceStatus: hookMocks.useTGridSourceStatus,
}));

type TestRows = Record<"orders", Record<string, unknown>>;

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
  children: [],
};

const query: TableLevelQuery = {
  columns: ordersTable.columns,
  filters: [],
  search: null,
  searchable: true,
  hasSort: false,
  activeFilterCount: 0,
  addFilter: vi.fn(),
  updateFilter: vi.fn(),
  removeFilter: vi.fn(),
  setSearch: vi.fn(),
  clearSort: vi.fn(),
};

const getVisibleRows = vi.fn(() => [{ id: "order-1" }]);
const reloadRows = vi.fn(async () => undefined);
const session = {
  csvExportUrl: () => "/api/tables/orders/export",
  getVisibleRows,
  reloadRows,
} as unknown as TGridSession<TestRows>;

const actionPropsSpy =
  vi.fn<(props: TableGridActionsProps<TestRows>) => void>();
const viewPreferenceChange = vi.fn();

function TestActions(props: TableGridActionsProps<TestRows>): ReactElement {
  actionPropsSpy(props);
  const visibleRowCount = props.session.getVisibleRows(props.level).length;
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        void props.session.reloadRows(props.level).then(() => {
          if (props.surface === "action-sheet") props.close();
        });
      },
    },
    `Reload ${visibleRowCount} visible row${visibleRowCount === 1 ? "" : "s"}`,
  );
}

let mounted: { root: Root; container: HTMLDivElement } | null = null;

beforeEach(() => {
  hookMocks.useTableLevelQuery.mockReturnValue(query);
  hookMocks.useTableSelection.mockReturnValue({ kind: "none", count: 0 });
  hookMocks.useTGridSourceStatus.mockReturnValue({
    status: "ready",
    error: undefined,
    totalCount: 3,
  });
  actionPropsSpy.mockClear();
  viewPreferenceChange.mockClear();
  getVisibleRows.mockClear();
  reloadRows.mockClear();
});

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  hookMocks.useTableLevelQuery.mockReset();
  hookMocks.useTableSelection.mockReset();
  hookMocks.useTGridSourceStatus.mockReset();
  document.body.replaceChildren();
});

describe("TableGridHeader", () => {
  it("hides the search control when the table is not searchable", async () => {
    hookMocks.useTableLevelQuery.mockReturnValue({
      ...query,
      searchable: false,
    });
    mounted = await renderHeader("wide", {
      ...ordersTable,
      searchable: false,
    });

    expect(
      document.body.querySelector('input[placeholder="Search..."]'),
    ).toBeNull();
  });

  it("keeps the wide controls and filter row mounted while inserting delete before New", async () => {
    mounted = await renderHeader("wide");
    const search = searchInput();
    const filter = buttonWithText("Add filter");

    expect(document.body.textContent).toContain("Orders");
    expect(document.body.textContent).toContain("Export");
    expect(document.body.textContent).toContain("New record");
    expect(
      document.body.querySelector(
        'button[aria-label="Open table view options"]',
      ),
    ).toBeInstanceOf(HTMLButtonElement);

    const deleteSelected = vi.fn(async () => {});
    hookMocks.useTableSelection.mockReturnValue(
      rowsSelection(1, deleteSelected),
    );
    await rerenderHeader("wide");

    const deleteButton = buttonWithText("Delete 1 row");
    const newButton = buttonContainingText("New record");
    expect(deleteButton.className).toContain("h-sap-ctl");
    expect(
      deleteButton.compareDocumentPosition(newButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(searchInput()).toBe(search);
    expect(buttonWithText("Add filter")).toBe(filter);
  });

  it("keeps narrow search and filters mounted while replacing New and More", async () => {
    mounted = await renderHeader("narrowCards");
    const search = searchInput();
    const filter = buttonWithText("Filter");

    expect(
      document.body.querySelector('button[aria-label="New record"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      document.body.querySelector('button[aria-label="Open table actions"]'),
    ).toBeInstanceOf(HTMLButtonElement);

    hookMocks.useTableSelection.mockReturnValue(
      rowsSelection(
        2,
        vi.fn(async () => {}),
      ),
    );
    await rerenderHeader("narrowCards");

    const deleteButton = buttonWithText("Delete 2 rows");
    expect(deleteButton.className).toContain("h-10");
    expect(
      document.body.querySelector('button[aria-label="New record"]'),
    ).toBeNull();
    expect(
      document.body.querySelector('button[aria-label="Open table actions"]'),
    ).toBeNull();
    expect(searchInput()).toBe(search);
    expect(buttonWithText("Filter")).toBe(filter);

    hookMocks.useTableSelection.mockReturnValue({ kind: "none", count: 0 });
    await rerenderHeader("narrowCards");

    expect(
      document.body.querySelector('button[aria-label="New record"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      document.body.querySelector('button[aria-label="Open table actions"]'),
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("never shows delete controls for immutable tables", async () => {
    hookMocks.useTableSelection.mockReturnValue(
      rowsSelection(
        2,
        vi.fn(async () => {}),
      ),
    );
    const immutableTable = { ...ordersTable, immutable: true };
    mounted = await renderHeader("wide", immutableTable);

    expect(findButtonWithText("Delete 2 rows")).toBeUndefined();
    expect(document.body.textContent).toContain("Export");

    await rerenderHeader("narrowCards", immutableTable);

    expect(findButtonWithText("Delete 2 rows")).toBeUndefined();
    expect(
      document.body.querySelector('button[aria-label="Open table actions"]'),
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("confirms a snapshotted count and blocks dismissal and repeat deletion while pending", async () => {
    let resolveDelete: (() => void) | undefined;
    const deletion = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const deleteSelected = vi.fn(() => deletion);
    hookMocks.useTableSelection.mockReturnValue(
      rowsSelection(1, deleteSelected),
    );
    mounted = await renderHeader("wide");

    await act(async () => {
      buttonWithText("Delete 1 row").click();
    });

    const dialog = alertDialog();
    expect(dialog.textContent).toContain("Delete 1 row?");
    expect(dialog.textContent).toContain("This action cannot be undone.");
    expect(buttonWithText("Cancel", dialog).disabled).toBe(false);

    hookMocks.useTableSelection.mockReturnValue(
      rowsSelection(2, deleteSelected),
    );
    await rerenderHeader("wide");
    expect(alertDialog().textContent).toContain("Delete 1 row?");

    const confirm = buttonWithText("Delete 1 row", alertDialog());
    await act(async () => {
      confirm.click();
      confirm.click();
    });

    expect(deleteSelected).toHaveBeenCalledTimes(1);
    expect(buttonWithText("Deleting…", alertDialog()).disabled).toBe(true);
    expect(buttonWithText("Cancel", alertDialog()).disabled).toBe(true);
    expect(alertDialog().getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(alertDialog()).toBeInstanceOf(HTMLElement);

    await act(async () => {
      resolveDelete?.();
      await deletion;
    });

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    });
  });

  it("renders application actions in the wide toolbar with the live session and level", async () => {
    mounted = await renderHeader("wide", ordersTable, TestActions);

    expect(buttonWithText("Reload 1 visible row")).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(getVisibleRows).toHaveBeenCalledWith("orders");
    expect(actionPropsSpy).toHaveBeenCalledTimes(1);
    expect(actionPropsSpy.mock.calls[0]?.[0]).toMatchObject({
      session,
      level: "orders",
      surface: "toolbar",
    });
    expect("close" in (actionPropsSpy.mock.calls[0]?.[0] ?? {})).toBe(false);
  });

  it("renders application actions in the narrow action sheet and lets them close it", async () => {
    mounted = await renderHeader("narrowCards", ordersTable, TestActions);

    expect(findButtonWithText("Reload 1 visible row")).toBeUndefined();

    await act(async () => {
      const openActions = document.body.querySelector(
        'button[aria-label="Open table actions"]',
      );
      if (!(openActions instanceof HTMLButtonElement)) {
        throw new Error("expected the table actions trigger");
      }
      openActions.click();
    });

    expect(document.body.textContent).toContain("Table actions");
    const actionButton = buttonWithText("Reload 1 visible row");
    const props = actionPropsSpy.mock.calls.at(-1)?.[0];
    expect(props).toMatchObject({
      session,
      level: "orders",
      surface: "action-sheet",
    });
    expect(props?.surface === "action-sheet" && props.close).toEqual(
      expect.any(Function),
    );

    await act(async () => {
      actionButton.click();
      await Promise.resolve();
    });

    expect(reloadRows).toHaveBeenCalledWith("orders");
    await vi.waitFor(() => {
      expect(findButtonWithText("Reload 1 visible row")).toBeUndefined();
    });
  });

  it("lets people change the layout from the narrow action sheet", async () => {
    mounted = await renderHeader("narrowCards");

    await act(async () => {
      const openActions = document.body.querySelector(
        'button[aria-label="Open table actions"]',
      );
      if (!(openActions instanceof HTMLButtonElement)) {
        throw new Error("expected the table actions trigger");
      }
      openActions.click();
    });

    const layoutOptions = [...document.body.querySelectorAll("button")].filter(
      (button) => button.getAttribute("role") === "menuitemradio",
    );
    expect(layoutOptions.map((button) => button.textContent?.trim())).toEqual([
      "Auto",
      "Tabular",
      "Cards",
    ]);

    const tabular = layoutOptions.find(
      (button) => button.textContent?.trim() === "Tabular",
    );
    if (!(tabular instanceof HTMLButtonElement)) {
      throw new Error("expected the Tabular layout option");
    }

    await act(async () => {
      tabular.click();
    });

    expect(viewPreferenceChange).toHaveBeenCalledWith("tabular");
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain("Table actions");
    });
  });
});

function rowsSelection(
  count: number,
  deleteSelected: () => Promise<void>,
): Extract<TableSelection, { kind: "rows" }> {
  return {
    kind: "rows",
    count,
    clear: vi.fn(),
    deleteSelected,
  };
}

async function renderHeader(
  mode: "wide" | "narrowCards",
  table: TableSchema = ordersTable,
  actions?: ComponentType<TableGridActionsProps<TestRows>>,
): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(headerElement(mode, table, actions));
  });
  return { root, container };
}

async function rerenderHeader(
  mode: "wide" | "narrowCards",
  table: TableSchema = ordersTable,
): Promise<void> {
  if (!mounted) throw new Error("expected a mounted table header");
  await act(async () => {
    mounted?.root.render(headerElement(mode, table));
  });
}

function headerElement(
  mode: "wide" | "narrowCards",
  table: TableSchema,
  actions?: ComponentType<TableGridActionsProps<TestRows>>,
): ReactElement {
  return createElement(TableGridHeader<TestRows>, {
    mode,
    session,
    table,
    level: "orders",
    viewPreference: "auto",
    onViewPreferenceChange: viewPreferenceChange,
    onNewRecord: vi.fn(),
    actions,
  });
}

function searchInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(
    'input[placeholder="Search..."]',
  );
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("expected the table search input");
  }
  return input;
}

function alertDialog(): HTMLElement {
  const dialog = document.body.querySelector<HTMLElement>(
    '[role="alertdialog"]',
  );
  if (!dialog) throw new Error("expected an alert dialog");
  return dialog;
}

function buttonWithText(
  text: string,
  parent: ParentNode = document.body,
): HTMLButtonElement {
  const button = [...parent.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`expected button with text "${text}"`);
  }
  return button;
}

function buttonContainingText(
  text: string,
  parent: ParentNode = document.body,
): HTMLButtonElement {
  const button = [...parent.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`expected button containing text "${text}"`);
  }
  return button;
}

function findButtonWithText(
  text: string,
  parent: ParentNode = document.body,
): HTMLButtonElement | undefined {
  return [...parent.querySelectorAll("button")].find(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof HTMLButtonElement &&
      candidate.textContent?.trim() === text,
  );
}
