// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRowId, rootPath } from "../../grid/types/identity";
import type { CellEditorProps } from "../../grid/types/schema";
import { columnPreset } from "../columns";
import { SelectEditor } from "./SelectEditor";

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

describe("SelectEditor", () => {
  it("uses a typed edit seed only as the filter query", async () => {
    const commit = vi.fn();
    const container = await renderEditor({
      editStart: { trigger: "type", typedSeed: "str" },
      value: 1,
      commit,
    });

    expect(requiredInput(container).value).toBe("str");
    expect(optionTexts(container)).toEqual(["String one"]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("commits exact option values for mouse and keyboard selection", async () => {
    const commit = vi.fn();
    const container = await renderEditor({
      editStart: { trigger: "enter" },
      value: null,
      commit,
    });
    const input = requiredInput(container);

    await changeInput(input, "Numeric");
    const numeric = requiredOption(container, "Numeric one");
    await click(numeric);
    expect(commit).toHaveBeenLastCalledWith(1);

    commit.mockClear();
    await changeInput(input, "String");
    await pressKey(input, "ArrowDown");
    await pressKey(input, "Enter");
    expect(commit).toHaveBeenCalledWith("1");
  });

  it("never commits arbitrary query text", async () => {
    const commit = vi.fn();
    const container = await renderEditor({
      editStart: { trigger: "enter" },
      value: null,
      commit,
    });
    const input = requiredInput(container);

    await changeInput(input, "not an option");
    await pressKey(input, "Enter");

    expect(optionTexts(container)).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("cancels on Escape and when focus leaves the whole editor", async () => {
    const cancel = vi.fn();
    const container = await renderEditor({
      editStart: { trigger: "enter" },
      value: null,
      cancel,
    });
    const input = requiredInput(container);

    await pressKey(input, "Escape");
    expect(cancel).toHaveBeenCalledTimes(1);

    cancel.mockClear();
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => {
      outside.focus();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

async function renderEditor(
  overrides: Partial<CellEditorProps>,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const anchor = document.createElement("div");
  const path = rootPath("things");
  const column = columnPreset.select({
    id: "value",
    name: "Value",
    options: [
      { value: 1, label: "Numeric one" },
      { value: "1", label: "String one" },
      { value: "other", label: "Other" },
    ],
  });
  const props: CellEditorProps = {
    editStart: { trigger: "enter" },
    value: null,
    row: {
      kind: "data",
      id: makeRowId(path, "1"),
      rowSelectable: true,
      columns: { value: null },
      hasChildren: false,
      source: {
        rowKey: "1",
        levelName: "things",
        columns: { value: null },
      },
    },
    column,
    path,
    anchor,
    commit: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(SelectEditor, props)));
  return container;
}

function requiredInput(container: ParentNode): HTMLInputElement {
  const input = container.querySelector('input[data-grid-part="editor-input"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected the select editor input.");
  }
  return input;
}

function requiredOption(container: ParentNode, text: string): Element {
  const option = Array.from(container.querySelectorAll('[role="option"]')).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!option) throw new Error(`Expected option '${text}'.`);
  return option;
}

function optionTexts(container: ParentNode): string[] {
  return Array.from(container.querySelectorAll('[role="option"]')).map(
    (option) => option.textContent ?? "",
  );
}

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
