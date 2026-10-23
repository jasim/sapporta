// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { materializeTypedFilterCondition } from "@sapporta/shared/filter";
import { DateRangeCard, type DateRange } from "./DateRangeCard";

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

describe("DateRangeCard", () => {
  const dueColumn: ColumnSchema = { name: "due", label: "Due", kind: "date" };
  const range: DateRange = {
    column: dueColumn,
    gte: materializeTypedFilterCondition(
      { column: "due", op: "gte", value: "2026-08-01" },
      { columns: [dueColumn] },
      "gte-id",
    ) as DateRange["gte"],
    lte: materializeTypedFilterCondition(
      { column: "due", op: "lte", value: "2026-08-31" },
      { columns: [dueColumn] },
      "lte-id",
    ) as DateRange["lte"],
  };

  it("removes a bound when its date is cleared", async () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const [from] = await openPickers(
      createElement(DateRangeCard, { range, onUpdate, onRemove }),
    );

    await changeDate(from, "");

    expect(onRemove).toHaveBeenCalledWith("gte-id");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("updates a bound when a date is picked", async () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const [, to] = await openPickers(
      createElement(DateRangeCard, { range, onUpdate, onRemove }),
    );

    await changeDate(to, "2026-09-15");

    expect(onRemove).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(
      "lte-id",
      expect.objectContaining({ id: "lte-id", op: "lte" }),
    );
  });
});

async function openPickers(
  element: Parameters<Root["render"]>[0],
): Promise<HTMLInputElement[]> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  mounted = { root, container };
  const trigger = container.querySelector("button");
  if (!trigger) throw new Error("Expected the range card trigger.");
  await act(async () => {
    trigger.click();
  });
  const inputs = Array.from(
    document.body.querySelectorAll<HTMLInputElement>('input[type="date"]'),
  );
  if (inputs.length !== 2) throw new Error("Expected two date pickers.");
  return inputs;
}

async function changeDate(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
