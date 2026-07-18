// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { FormField, parseRecordNumberInput } from "./FormField";

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

describe("parseRecordNumberInput", () => {
  it("returns finite numbers for generated numeric fields", () => {
    expect(parseRecordNumberInput("42")).toBe(42);
    expect(parseRecordNumberInput("12.50")).toBe(12.5);
    expect(parseRecordNumberInput("-3.25")).toBe(-3.25);
  });

  it("returns null for empty or non-finite input", () => {
    expect(parseRecordNumberInput("")).toBeNull();
    expect(parseRecordNumberInput("NaN")).toBeNull();
    expect(parseRecordNumberInput("Infinity")).toBeNull();
  });

  it("preserves empty text as distinct from null", async () => {
    const onChange = vi.fn();
    const column: ColumnSchema = {
      name: "notes",
      label: "Notes",
      kind: "text",
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };

    await act(async () => {
      root.render(
        createElement(FormField, {
          field: { kind: "text", column },
          value: "previous",
          onChange,
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("");
  });
});
