// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CachedSearchLookup,
  CachedValueLookup,
  StaticSearchLookup,
  StaticValueLookup,
  type LookupCapabilities,
  type LookupValue,
} from "@sapporta/grid/lookup";
import {
  LookupPicker,
  type LookupPickerItemDisplay,
  type LookupPickerItemProps,
} from "./LookupPicker";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

async function renderLookupPicker<TValue extends LookupValue, TMeta = unknown>(
  lookup: LookupCapabilities<TValue, TMeta>,
  args: {
    value: TValue | null;
    onChange?: (value: TValue | null) => void;
    itemDisplay?: LookupPickerItemDisplay<TValue, TMeta>;
    disabled?: boolean;
    allowClear?: boolean;
    id?: string;
  },
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const onChange: (value: TValue | null) => void =
    args.onChange ?? (() => undefined);

  await act(async () => {
    root.render(
      createElement(LookupPicker<TValue, TMeta>, {
        lookup,
        value: args.value,
        onChange,
        itemDisplay: args.itemDisplay,
        placeholder: "Select person",
        disabled: args.disabled,
        allowClear: args.allowClear,
        id: args.id,
      }),
    );
  });

  return container;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function typeInto(
  element: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(
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

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (err: unknown) {
      lastError = err;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

function textContent(): string {
  return document.body.textContent ?? "";
}

function comboboxInput(): HTMLInputElement {
  const input = document.querySelector('input[role="combobox"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Could not find combobox input.");
  }
  return input;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button labelled '${label}'.`);
  }
  return button;
}

function comboboxOptionByText(text: string): Element {
  const element = Array.from(document.querySelectorAll('[role="option"]')).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!element) {
    throw new Error(`Could not find combobox option '${text}'.`);
  }
  return element;
}

describe("LookupPicker", () => {
  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
    document.body.replaceChildren();
  });

  it("loads the selected label", async () => {
    const lookup: LookupCapabilities = {
      valueLookup: new CachedValueLookup({
        loadEntriesForValues: async (values) =>
          values.map((value) => ({ value, label: `User ${String(value)}` })),
      }),
      searchLookup: new StaticSearchLookup([]),
    };

    await renderLookupPicker(lookup, { value: 12 });

    await waitFor(() => {
      expect(comboboxInput().value).toBe("User 12");
    });
  });

  it("drives remote search from cumulative input without local filtering", async () => {
    const searchedFor: string[] = [];
    const searchLookup = new CachedSearchLookup({
      loadEntriesForSearch: async ({ searchText }) => {
        searchedFor.push(searchText);
        return {
          entries:
            searchText === "zz"
              ? [{ value: "remote", label: "Visible remote result" }]
              : [],
        };
      },
    });
    const lookup: LookupCapabilities = {
      valueLookup: new StaticValueLookup([]),
      searchLookup,
    };

    await renderLookupPicker(lookup, { value: null });
    const input = comboboxInput();

    await typeInto(input, "z");
    await typeInto(input, "zz");

    await waitFor(() => {
      expect(textContent()).toContain("Visible remote result");
    });
    expect(input.value).toBe("zz");
    expect(searchedFor).toContain("z");
    expect(searchedFor).toContain("zz");
  });

  it("renders metadata fields in the configured order", async () => {
    type Customer = {
      name: string;
      email: string;
      status: string;
    };
    const entry = {
      value: 7,
      label: "Alice Adams",
      meta: {
        name: "Alice Adams",
        email: "alice@example.com",
        status: "active",
      },
    };
    const lookup: LookupCapabilities<number, Customer> = {
      valueLookup: new StaticValueLookup([entry]),
      searchLookup: new StaticSearchLookup([entry]),
    };

    await renderLookupPicker(lookup, {
      value: 7,
      itemDisplay: { fields: ["name", "email", "status"] },
    });
    await pressKey(comboboxInput(), "ArrowDown");

    const option = comboboxOptionByText("alice@example.com");
    expect(option.textContent).toContain(
      "Alice Adams|alice@example.com|active",
    );
    expect(comboboxInput().value).toBe("Alice Adams");
  });

  it("passes a complete asynchronously loaded entry to a custom item component", async () => {
    type Customer = { name: string; email: string };

    function CustomerItem({ entry }: LookupPickerItemProps<number, Customer>) {
      return createElement(
        "span",
        { "data-customer-email": entry.meta.email },
        `${entry.meta.name} (${entry.meta.email})`,
      );
    }

    const lookup: LookupCapabilities<number, Customer> = {
      valueLookup: new CachedValueLookup({
        loadEntriesForValues: async (values) =>
          values.map((value) => ({
            value,
            label: String(value),
            meta: { name: "Alice Adams", email: "alice@example.com" },
          })),
      }),
      searchLookup: new StaticSearchLookup([]),
    };

    await renderLookupPicker(lookup, {
      value: 7,
      itemDisplay: { fields: ["name", "email"], component: CustomerItem },
    });
    await pressKey(comboboxInput(), "ArrowDown");

    await waitFor(() => {
      expect(
        document.querySelector('[data-customer-email="alice@example.com"]')
          ?.textContent,
      ).toBe("Alice Adams (alice@example.com)");
    });
    expect(comboboxInput().value).toBe("7");
  });

  it("clears to null", async () => {
    const onChange = vi.fn();
    const lookup: LookupCapabilities = {
      valueLookup: new StaticValueLookup([{ value: 7, label: "Seven" }]),
      searchLookup: new StaticSearchLookup([{ value: 7, label: "Seven" }]),
    };

    await renderLookupPicker(lookup, { value: 7, onChange });
    await waitFor(() => {
      expect(comboboxInput().value).toBe("Seven");
    });
    await click(buttonByLabel("Clear selection"));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it.each([
    ["numeric", 42],
    ["string", "42"],
  ] as const)("preserves %s ids", async (_kind, expectedValue) => {
    const onChange = vi.fn();
    const lookup: LookupCapabilities = {
      valueLookup: new StaticValueLookup([]),
      searchLookup: new StaticSearchLookup([
        { value: expectedValue, label: "Forty two" },
      ]),
    };

    await renderLookupPicker(lookup, { value: null, onChange });
    await pressKey(comboboxInput(), "ArrowDown");
    await click(comboboxOptionByText("Forty two"));

    expect(onChange).toHaveBeenCalledWith(expectedValue);
  });

  it("passes through the id, disabled state, and clear policy", async () => {
    const lookup: LookupCapabilities = {
      valueLookup: new StaticValueLookup([{ value: 7, label: "Seven" }]),
      searchLookup: new StaticSearchLookup([{ value: 7, label: "Seven" }]),
    };

    await renderLookupPicker(lookup, {
      value: 7,
      disabled: true,
      allowClear: false,
      id: "person-id",
    });

    await waitFor(() => {
      expect(comboboxInput().value).toBe("Seven");
    });
    expect(comboboxInput().id).toBe("person-id");
    expect(comboboxInput().disabled).toBe(true);
    expect(buttonByLabel("Open popup").disabled).toBe(true);
    expect(
      document.querySelector('button[aria-label="Clear selection"]'),
    ).toBeNull();
  });
});
