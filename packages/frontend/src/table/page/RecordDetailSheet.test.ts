// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRowId, rootPath } from "@sapporta/grid";
import type { TableSchema } from "@sapporta/shared/contracts";
import { setAppTimeZone } from "../../platform/app-time-zone";
import type { TableRowsClient } from "../tgrid/tgrid-level-config";
import { defineTGrid } from "../tgrid/tgrid-runtime-config";
import { createTGridSession, type TGridSession } from "../tgrid/tgrid-session";
import { RecordDetailSheet, type RecordDetailTarget } from "./RecordDetailSheet";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Boot publishes the workspace zone before any screen renders; these tests
// mount the pieces directly, so they stand in for it.
setAppTimeZone("UTC");

type Rows = {
  assets: {
    id: number;
    name: string;
    purchased_on: string | null;
    notes: string | null;
  };
};

const assetsTable: TableSchema = {
  name: "assets",
  label: "Assets",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  columns: [
    { name: "id", label: "ID", kind: "number", primary: true, hasDefault: true },
    { name: "name", label: "Name", kind: "text", notNull: true },
    { name: "purchased_on", label: "Purchased", kind: "date" },
    { name: "notes", label: "Notes", kind: "text" },
  ],
  children: [],
};

function makeRowsClient(): TableRowsClient {
  return {
    fetch: vi.fn(async () => ({
      data: [
        {
          id: 1,
          name: "Forklift 2.5t",
          purchased_on: "2021-03-02",
          notes: null,
        },
        { id: 2, name: "Pallet Wrapper", purchased_on: null, notes: "Slow" },
      ],
      meta: { total: 2, page: 1, limit: 50, pages: 1 },
    })),
    create: vi.fn(async (_table, data) => ({ data })),
    update: vi.fn(async (_table, _id, data) => ({ data })),
    remove: vi.fn(async (_table, id) => ({ data: { id } })),
  };
}

let mounted: { root: Root; container: HTMLElement } | null = null;
const sessions: TGridSession<Rows>[] = [];

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
  document.body.innerHTML = "";
});

async function mountSheet(args: {
  rowsClient: TableRowsClient;
  rowKey?: string;
  onClose?: () => void;
}): Promise<{ session: TGridSession<Rows>; target: RecordDetailTarget }> {
  const definition = defineTGrid<Rows>({
    rootLevel: "assets",
    levels: {
      assets: {
        table: assetsTable,
        rowHeaderColumn: "none",
        childLevels: [],
        rowsClient: args.rowsClient,
      },
    },
  });
  const session = createTGridSession(definition);
  sessions.push(session);
  await act(async () => {
    await session.reloadRows();
  });

  const path = rootPath("assets");
  const target: RecordDetailTarget = {
    levelId: "assets",
    rowId: makeRowId(path, args.rowKey ?? "1"),
    path,
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(RecordDetailSheet<Rows>, {
        session,
        target,
        onClose: args.onClose ?? (() => undefined),
      }),
    );
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
  mounted = { root, container };
  return { session, target };
}

function sheetRoot(): HTMLElement {
  const sheet = document.body.querySelector(
    '[data-grid-part="record-detail-sheet"]',
  );
  if (!(sheet instanceof HTMLElement)) {
    throw new Error("expected the record detail sheet to be rendered");
  }
  return sheet;
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("expected an element to click");
  }
  await act(async () => {
    element.click();
  });
}

describe("RecordDetailSheet", () => {
  it("shows every table-backed field with the row-label title", async () => {
    await mountSheet({ rowsClient: makeRowsClient() });

    const sheet = sheetRoot();
    const fields = [
      ...sheet.querySelectorAll("[data-record-detail-field]"),
    ].map((field) => field.getAttribute("data-record-detail-field"));
    expect(fields).toEqual(["id", "name", "purchased_on", "notes"]);
    expect(sheet.textContent).toContain("Forklift 2.5t");
    expect(sheet.textContent).toContain("2021-03-02");
    // The title comes from the table's row-label column.
    expect(sheet.querySelector("h2")?.textContent).toBe("Forklift 2.5t");
  });

  it("offers editing only on writable fields", async () => {
    await mountSheet({ rowsClient: makeRowsClient() });

    const sheet = sheetRoot();
    // The primary key identifies the record and stays readonly.
    expect(
      sheet.querySelector('[data-record-detail-field="id"]')?.tagName,
    ).toBe("DIV");
    expect(
      sheet.querySelector('button[aria-label="Edit Name"]'),
    ).toBeInstanceOf(HTMLElement);
    // Date columns are editable here even though grid cells cannot edit them.
    expect(
      sheet.querySelector('button[aria-label="Edit Purchased"]'),
    ).toBeInstanceOf(HTMLElement);
  });

  it("edits a field through the form control and saves via the table patch path", async () => {
    const rowsClient = makeRowsClient();
    const { session } = await mountSheet({ rowsClient });

    await click(sheetRoot().querySelector('button[aria-label="Edit Name"]'));

    const input = sheetRoot().querySelector<HTMLInputElement>("#field-name");
    if (!input) throw new Error("expected the name form control");
    expect(input.value).toBe("Forklift 2.5t");

    await changeInput(input, "Forklift 3t");
    const saveButton = [...sheetRoot().querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    await click(saveButton ?? null);

    expect(rowsClient.update).toHaveBeenCalledWith("assets", "1", {
      name: "Forklift 3t",
    });
    // The editor closes and the optimistic value shows immediately.
    expect(sheetRoot().querySelector("#field-name")).toBeNull();
    expect(sheetRoot().textContent).toContain("Forklift 3t");
    expect(session.getLoadedRow("1")?.name).toBe("Forklift 3t");
  });

  it("saves an edited date column through the same patch path", async () => {
    const rowsClient = makeRowsClient();
    await mountSheet({ rowsClient });

    await click(
      sheetRoot().querySelector('button[aria-label="Edit Purchased"]'),
    );
    const input = sheetRoot().querySelector<HTMLInputElement>(
      "#field-purchased_on",
    );
    if (!input) throw new Error("expected the date form control");
    expect(input.value).toBe("2021-03-02");

    await changeInput(input, "2024-01-30");
    const saveButton = [...sheetRoot().querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
    await click(saveButton ?? null);

    expect(rowsClient.update).toHaveBeenCalledWith("assets", "1", {
      purchased_on: "2024-01-30",
    });
  });

  it("closes itself when the row leaves the displayed set", async () => {
    const onClose = vi.fn();
    const { session } = await mountSheet({
      rowsClient: makeRowsClient(),
      onClose,
    });

    await act(async () => {
      await session.runtime.root.removeRow("1");
    });

    expect(onClose).toHaveBeenCalled();
  });
});
