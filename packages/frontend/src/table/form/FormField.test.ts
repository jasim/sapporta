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
});

async function renderInput(
  props: Parameters<typeof FormField>[0],
): Promise<HTMLInputElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(FormField, props)));
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
