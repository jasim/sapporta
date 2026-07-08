// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StaticSearchLookup, StaticValueLookup } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { NumberInput } from "./ScalarInput";
import { LookupCheckboxList } from "./LookupCheckboxList";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(async () => {
  if (!mounted) return;
  await act(async () => {
    mounted?.root.unmount();
  });
  mounted.container.remove();
  mounted = null;
});

describe("filter input drafts", () => {
  const amountColumn: ColumnSchema = {
    name: "amount",
    label: "Amount",
    kind: "number",
  };
  const customerColumn: ColumnSchema = {
    name: "customer_id",
    label: "Customer",
    kind: "number",
    foreignKey: { table: "customers", column: "id" },
  };

  it("edits scalar number input as a string draft", async () => {
    const onChange = vi.fn();
    const container = await render(
      createElement(NumberInput, {
        value: "",
        onChange,
        column: amountColumn,
      }),
    );

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    await act(async () => {
      if (!input) return;
      setInputValue(input, "42");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("42");
  });

  it("keeps numeric lookup selections numeric in list drafts", async () => {
    const onChange = vi.fn();
    const lookup = {
      valueLookup: new StaticValueLookup([{ value: 7, label: "Seven" }]),
      searchLookup: new StaticSearchLookup([{ value: 7, label: "Seven" }]),
    };
    const container = await render(
      createElement(LookupCheckboxList, {
        values: [],
        onChange,
        column: customerColumn,
        lookup,
      }),
    );

    const option = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Seven"),
    );
    expect(option).not.toBeUndefined();

    await act(async () => {
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith([7]);
  });
});

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  mounted = { root, container };
  return container;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
}
