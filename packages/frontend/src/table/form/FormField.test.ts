// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { FormField } from "./FormField";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(async () => {
  if (!mounted) return;
  await act(async () => mounted?.root.unmount());
  mounted.container.remove();
  mounted = null;
});

describe("FormField drafts", () => {
  it("preserves incomplete numeric text until submit", async () => {
    const onChange = vi.fn();
    const column: ColumnSchema = {
      name: "total",
      label: "Total",
      kind: "number",
      displayFormat: "currency",
    };
    const input = await renderInput({
      field: { kind: "currency", column },
      value: "-",
      onChange,
    });

    expect(input.type).toBe("text");
    expect(input.value).toBe("-");
    await changeInput(input, "12.");
    expect(onChange).toHaveBeenLastCalledWith("12.");
    await changeInput(input, "not-a-number");
    expect(onChange).toHaveBeenLastCalledWith("not-a-number");
  });

  it("preserves empty text as distinct from null", async () => {
    const onChange = vi.fn();
    const column: ColumnSchema = {
      name: "notes",
      label: "Notes",
      kind: "text",
    };
    const input = await renderInput({
      field: { kind: "text", column },
      value: "previous",
      onChange,
    });

    await changeInput(input, "");

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("searches enum options without changing the draft and selects exact strings", async () => {
    const onChange = vi.fn();
    const container = await renderField({
      field: {
        kind: "select",
        column: statusColumn(),
        options: ["draft", "ready"],
      },
      value: null,
      onChange,
    });
    const input = requiredComboboxInput(container);

    await changeInput(input, "dra");
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("dra");

    await pressKey(input, "ArrowDown");
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    expect(options.map((option) => option.textContent)).toEqual(["draft"]);
    await click(options[0]);

    expect(onChange).toHaveBeenCalledWith("draft");
  });

  it("clears an enum to null and connects field accessibility to the input", async () => {
    const onChange = vi.fn();
    const container = await renderField({
      field: {
        kind: "select",
        column: statusColumn(),
        options: ["draft", "ready"],
      },
      value: "draft",
      issue: "Choose a status.",
      onChange,
    });
    const input = requiredComboboxInput(container);

    expect(input.id).toBe("field-status");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("field-status-error");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);

    const clear = container.querySelector(
      'button[aria-label="Clear selection"]',
    );
    if (!clear) throw new Error("Expected a clear selection button.");
    await click(clear);

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

function statusColumn(): ColumnSchema {
  return {
    name: "status",
    label: "Status",
    kind: "text",
    select: { options: ["draft", "ready"] },
  };
}

async function renderField(
  props: Parameters<typeof FormField>[0],
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(FormField, props)));
  return container;
}

async function renderInput(
  props: Parameters<typeof FormField>[0],
): Promise<HTMLInputElement> {
  const container = await renderField(props);
  const input = container.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error("Expected FormField to render an input.");
  return input;
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

function requiredComboboxInput(container: ParentNode): HTMLInputElement {
  const input = container.querySelector('input[role="combobox"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected a combobox input.");
  }
  return input;
}

async function pressKey(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}
