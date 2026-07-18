// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { ConditionEditor } from "./ConditionEditor";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  document.body.replaceChildren();
});

describe("ConditionEditor enum interaction", () => {
  it("selects an enum option when clicked", async () => {
    const onApply = vi.fn();
    const status: ColumnSchema = {
      name: "status",
      label: "Status",
      kind: "text",
      select: { options: ["draft", "done"] },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };
    await act(async () => {
      root.render(
        createElement(ConditionEditor, {
          columns: [status],
          lockedColumn: status,
          onApply,
          onCancel: vi.fn(),
        }),
      );
    });

    const option = container.querySelector('[role="option"]');
    if (!option) throw new Error("Expected an enum option.");
    expect(option.closest("label")).toBeNull();
    await click(option);

    expect(option.getAttribute("aria-selected")).toBe("true");
    const apply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply",
    );
    if (!apply) throw new Error("Expected the Apply button.");
    expect(apply.disabled).toBe(false);
    await click(apply);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        column: "status",
        op: "in",
        values: ["draft"],
      }),
    );
  });

  it("lets Enter select a highlighted enum option before Apply", async () => {
    const onApply = vi.fn();
    const status: ColumnSchema = {
      name: "status",
      label: "Status",
      kind: "text",
      select: { options: ["draft", "done"] },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };
    await act(async () => {
      root.render(
        createElement(ConditionEditor, {
          columns: [status],
          lockedColumn: status,
          onApply,
          onCancel: vi.fn(),
        }),
      );
    });
    const input = container.querySelector('input[role="combobox"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected the enum combobox input.");
    }

    await changeInput(input, "dra");
    await pressKey(input, "ArrowDown");
    await pressKey(input, "Enter");

    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain("draft");

    const apply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply",
    );
    if (!apply) throw new Error("Expected the Apply button.");
    await click(apply);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        column: "status",
        op: "in",
        values: ["draft"],
      }),
    );
  });
});

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value.at(-1) ?? null,
        inputType: "insertText",
      }),
    );
  });
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
