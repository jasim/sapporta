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
} from "@sapporta/grid/lookup";
import { LookupPicker } from "./LookupPicker";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

async function renderLookupPicker(
  lookup: LookupCapabilities,
  args: {
    value: string | number | null;
    onChange?: (value: string | number | null) => void;
  },
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };

  await act(async () => {
    root.render(
      createElement(LookupPicker, {
        lookup,
        value: args.value,
        onChange: args.onChange ?? vi.fn(),
        placeholder: "Select person",
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
    element.dispatchEvent(new Event("input", { bubbles: true }));
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

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button '${text}'.`);
  }
  return button;
}

function commandItemByText(text: string): Element {
  const element = Array.from(document.querySelectorAll("[cmdk-item]")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!element) {
    throw new Error(`Could not find command item '${text}'.`);
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
      expect(textContent()).toContain("User 12");
    });
  });

  it("searches through the lookup source without applying local filtering", async () => {
    const searchLookup = new CachedSearchLookup({
      loadEntriesForSearch: async ({ searchText }) => ({
        entries:
          searchText === "zz"
            ? [{ value: "remote", label: "Visible remote result" }]
            : [],
      }),
    });
    const lookup: LookupCapabilities = {
      valueLookup: new StaticValueLookup([]),
      searchLookup,
    };

    await renderLookupPicker(lookup, { value: null });
    await click(buttonByText("Select person"));
    const input = document.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected combobox input.");
    }

    await typeInto(input, "zz");

    await waitFor(() => {
      expect(textContent()).toContain("Visible remote result");
    });
  });

  it("clears to null", async () => {
    const onChange = vi.fn();
    const lookup: LookupCapabilities = {
      valueLookup: new StaticValueLookup([{ value: 7, label: "Seven" }]),
      searchLookup: new StaticSearchLookup([{ value: 7, label: "Seven" }]),
    };

    await renderLookupPicker(lookup, { value: 7, onChange });
    await click(buttonByText("Seven"));
    await click(commandItemByText("Clear"));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("preserves numeric ids", async () => {
    const onChange = vi.fn();
    const lookup: LookupCapabilities = {
      valueLookup: new StaticValueLookup([]),
      searchLookup: new StaticSearchLookup([{ value: 42, label: "Forty two" }]),
    };

    await renderLookupPicker(lookup, { value: null, onChange });
    await click(buttonByText("Select person"));
    await click(commandItemByText("Forty two"));

    expect(onChange).toHaveBeenCalledWith(42);
  });
});
