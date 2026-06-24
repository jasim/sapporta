// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pagination } from "./Pagination";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: ReactElement): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

async function changeInputValue(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!valueSetter) throw new Error("expected input value setter");

  await act(async () => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blurInput(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus();
  });
  await act(async () => {
    input.blur();
  });
}

function pageInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Page number, 1 through 10"]',
  );
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("expected page jump input");
  }
  return input;
}

describe("Pagination", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
  });

  it("commits a valid typed page when the input blurs", async () => {
    const onPageChange = vi.fn();
    mounted = await render(
      createElement(Pagination, { page: 2, pages: 10, onPageChange }),
    );

    const input = pageInput(mounted.container);
    await changeInputValue(input, "7");

    await blurInput(input);

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(7);
    expect(input.value).toBe("7");
  });

  it("resets an invalid typed page on blur without changing pages", async () => {
    const onPageChange = vi.fn();
    mounted = await render(
      createElement(Pagination, { page: 2, pages: 10, onPageChange }),
    );

    const input = pageInput(mounted.container);
    await changeInputValue(input, "11");

    await blurInput(input);

    expect(onPageChange).not.toHaveBeenCalled();
    expect(input.value).toBe("2");
  });
});
