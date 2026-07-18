// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StaticSearchLookup, StaticValueLookup } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { NumberInput } from "./ScalarInput";
import { EnumCombobox } from "./EnumCombobox";
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
  const statusColumn: ColumnSchema = {
    name: "status",
    label: "Status",
    kind: "text",
    select: { options: ["draft", "done"] },
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

  it("selects multiple enum strings without committing search text", async () => {
    const onChange = vi.fn();
    const container = await render(
      createElement(EnumCombobox, {
        values: [],
        onChange,
        column: statusColumn,
        options: ["draft", "done"],
        labels: { draft: "In progress", done: "Complete" },
      }),
    );
    const input = requiredComboboxInput(container);

    await changeInput(input, "progress");
    expect(onChange).not.toHaveBeenCalled();
    expect(optionTexts(container)).toEqual(["In progress"]);

    const option = container.querySelector('[role="option"]');
    if (!option) throw new Error("Expected a filtered enum option.");
    await click(option);

    expect(onChange).toHaveBeenCalledWith(["draft"]);
  });

  it("renders and removes selected enum values retired from the option list", async () => {
    const onChange = vi.fn();
    const container = await render(
      createElement(EnumCombobox, {
        values: ["retired", "draft"],
        onChange,
        column: statusColumn,
        options: ["draft", "done"],
        labels: { draft: "In progress" },
      }),
    );

    expect(container.textContent).toContain("retired");
    expect(optionTexts(container)).not.toContain("retired");
    const remove = container.querySelector(
      'button[aria-label="Remove retired"]',
    );
    if (!remove) throw new Error("Expected the retired value remove button.");
    await click(remove);

    expect(onChange).toHaveBeenCalledWith(["draft"]);
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

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    setInputValue(input, value);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value.at(-1) ?? null,
        inputType: "insertText",
      }),
    );
  });
}

function requiredComboboxInput(container: ParentNode): HTMLInputElement {
  const input = container.querySelector('input[role="combobox"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected a combobox input.");
  }
  return input;
}

function optionTexts(container: ParentNode): string[] {
  return Array.from(container.querySelectorAll('[role="option"]')).map(
    (option) => option.textContent ?? "",
  );
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}
