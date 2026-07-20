// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@sapporta/shared/client";
import type { TableSchema } from "@sapporta/shared/contracts";
import { NewRecordPage } from "./NewRecordPage";

const { createTableRow } = vi.hoisted(() => ({
  createTableRow: vi.fn(),
}));

vi.mock("../api/rows", () => ({ createTableRow }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TABLE: TableSchema = {
  name: "projects",
  label: "Projects",
  immutable: false,
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

afterEach(async () => {
  createTableRow.mockReset();
  if (!mounted) return;
  await act(async () => mounted?.root.unmount());
  mounted.container.remove();
  mounted = null;
});

describe("NewRecordPage", () => {
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
});

async function renderPage(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(NewRecordPage, { tableSchema: TABLE }),
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
