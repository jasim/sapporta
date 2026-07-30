// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberedTablePager } from "./TablePagers";
import { clampPage, parsePageJump } from "./table-pager-math";

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

async function pressKey(
  element: HTMLElement,
  key: string,
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event;
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

describe("table pager math", () => {
  it("clamps page numbers to the available range", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(Number.NaN, 10)).toBe(1);
  });

  it("parses bounded page jumps", () => {
    expect(parsePageJump("7", 10)).toBe(7);
    expect(parsePageJump("11", 10)).toBeUndefined();
    expect(parsePageJump("abc", 10)).toBeUndefined();
  });
});

describe("NumberedTablePager", () => {
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
      createElement(NumberedTablePager, {
        page: 2,
        pages: 10,
        onPageChange,
      }),
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
      createElement(NumberedTablePager, { page: 2, pages: 10, onPageChange }),
    );

    const input = pageInput(mounted.container);
    await changeInputValue(input, "11");

    await blurInput(input);

    expect(onPageChange).not.toHaveBeenCalled();
    expect(input.value).toBe("2");
  });

  it("holds outward keys at the boundary and returns inward keys to the grid", async () => {
    const onPageChange = vi.fn();
    const onPagerArrowKey = vi.fn(() => {
      mounted?.container.focus();
      return true;
    });
    mounted = await render(
      createElement(NumberedTablePager, {
        page: 2,
        pages: 10,
        onPageChange,
        onPagerArrowKey,
      }),
    );
    const previous = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous page"]',
    );
    const next = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Next page"]',
    );
    if (!previous || !next) throw new Error("expected pagination buttons");
    mounted.container.tabIndex = -1;

    next.focus();
    for (const key of ["ArrowDown", "PageDown"]) {
      const event = await pressKey(next, key);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(next);
    }

    const up = await pressKey(next, "ArrowUp");

    expect(up.defaultPrevented).toBe(true);
    expect(onPagerArrowKey).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(mounted.container);

    previous.focus();
    const previousPageUp = await pressKey(previous, "PageUp");

    expect(previousPageUp.defaultPrevented).toBe(true);
    expect(onPagerArrowKey).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(previous);

    const previousPageDown = await pressKey(previous, "PageDown");

    expect(previousPageDown.defaultPrevented).toBe(true);
    expect(onPagerArrowKey).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(mounted.container);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("lets a boundary continuation own explicit button activation", async () => {
    const onPageChange = vi.fn();
    const onPagerButtonActivate = vi.fn(() => true);
    const onPagerBoundaryExit = vi.fn();
    mounted = await render(
      createElement(NumberedTablePager, {
        page: 2,
        pages: 10,
        onPageChange,
        onPagerButtonActivate,
        onPagerBoundaryExit,
      }),
    );
    const next = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Next page"]',
    );
    if (!next) throw new Error("expected next page button");

    await act(async () => {
      next.click();
    });

    expect(onPagerButtonActivate).toHaveBeenCalledWith("after");
    expect(onPageChange).not.toHaveBeenCalled();
    expect(onPagerBoundaryExit).not.toHaveBeenCalled();
  });

  it("cancels a pending boundary before an ordinary pager click", async () => {
    const onPageChange = vi.fn();
    const onPagerBoundaryExit = vi.fn();
    mounted = await render(
      createElement(NumberedTablePager, {
        page: 2,
        pages: 10,
        onPageChange,
        onPagerBoundaryExit,
      }),
    );
    const next = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Next page"]',
    );
    if (!next) throw new Error("expected next page button");

    await act(async () => {
      next.click();
    });

    expect(onPagerBoundaryExit).toHaveBeenCalledOnce();
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
