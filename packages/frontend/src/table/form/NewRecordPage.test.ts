// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@sapporta/shared/client";
import type { TableSchema } from "@sapporta/shared/contracts";
import { tableQueryKeys } from "../query";
import { NewRecordPage } from "./NewRecordPage";
import { setAppTimeZone } from "../../platform/app-time-zone";

// Boot publishes the workspace zone before any screen renders; these tests
// mount the pieces directly, so they stand in for it.
setAppTimeZone("UTC");

const { createTableRow, reloadTGridRows } = vi.hoisted(() => ({
  createTableRow: vi.fn(),
  reloadTGridRows: vi.fn(),
}));

vi.mock("../api/rows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/rows")>()),
  createTableRow,
}));
vi.mock("../tgrid/tgrid-session-registry", () => ({ reloadTGridRows }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TABLE: TableSchema = {
  name: "projects",
  label: "Projects",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  children: [],
  columns: [
    {
      name: "id",
      label: "ID",
      kind: "number",
      primary: true,
      hasDefault: true,
    },
    { name: "name", label: "Name", kind: "text", notNull: true },
  ],
};

let mounted: { root: Root; container: HTMLElement } | null = null;
let queryClient: QueryClient | null = null;

afterEach(async () => {
  createTableRow.mockReset();
  reloadTGridRows.mockReset();
  queryClient?.clear();
  queryClient = null;
  if (!mounted) return;
  await act(async () => mounted?.root.unmount());
  mounted.container.remove();
  mounted = null;
});

describe("NewRecordPage", () => {
  it("uses the standard page header and scrolling body", async () => {
    const container = await renderPage();

    expect(container.querySelector("[data-page-header]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(container.querySelector("[data-page-body]")).toBeInstanceOf(
      HTMLElement,
    );
  });

  it("maps create-draft issues into TanStack field errors", async () => {
    const container = await renderPage();

    await submit(container);

    expect(container.textContent).toContain("Name is required.");
    expect(createTableRow).not.toHaveBeenCalled();
  });

  it("shows the server's error text when creation fails", async () => {
    createTableRow.mockRejectedValue(
      new ApiError(422, { error: "A project with that name already exists." }),
    );
    const container = await renderPage();
    const input = container.querySelector<HTMLInputElement>("#field-name");
    if (!input) throw new Error("Expected the project name input.");

    await changeInput(input, "Roadmap");
    await submit(container);

    expect(container.textContent).toContain(
      "A project with that name already exists.",
    );
  });

  it("maps structured server details into TanStack field errors", async () => {
    createTableRow.mockRejectedValue(
      new ApiError(422, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        details: [
          { field: "name", message: "A project with this name exists." },
        ],
      }),
    );
    const container = await renderPage();
    const input = container.querySelector<HTMLInputElement>("#field-name");
    if (!input) throw new Error("Expected the project name input.");

    await changeInput(input, "Roadmap");
    await submit(container);

    expect(container.textContent).toContain("Validation failed");
    expect(container.textContent).toContain("A project with this name exists.");
  });

  it("invalidates the table query hierarchy and reloads mounted grids after creation", async () => {
    createTableRow.mockResolvedValue({ data: { id: 42, name: "Roadmap" } });
    const pageKey = tableQueryKeys.page({
      tableName: TABLE.name,
      page: 1,
      limit: 20,
    });
    const otherTableKey = tableQueryKeys.page({
      tableName: "teams",
      page: 1,
      limit: 20,
    });
    const container = await renderPage();
    queryClient?.setQueryData(pageKey, { data: [], meta: {} });
    queryClient?.setQueryData(otherTableKey, { data: [], meta: {} });
    const input = container.querySelector<HTMLInputElement>("#field-name");
    if (!input) throw new Error("Expected the project name input.");

    await changeInput(input, "Roadmap");
    await submit(container);

    expect(reloadTGridRows).toHaveBeenCalledWith(TABLE.name);
    expect(queryClient?.getQueryState(pageKey)?.isInvalidated).toBe(true);
    expect(queryClient?.getQueryState(otherTableKey)?.isInvalidated).toBe(
      false,
    );
  });
});

async function renderPage(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mounted = { root, container };
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient! },
        createElement(
          MemoryRouter,
          null,
          createElement(NewRecordPage, { tableSchema: TABLE }),
        ),
      ),
    );
  });
  return container;
}

async function submit(container: ParentNode): Promise<void> {
  const form = container.querySelector("form");
  if (!form) throw new Error("Expected the new-record form.");
  await act(async () => {
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function changeInput(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
