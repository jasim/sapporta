// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  NARROW_TABLE_PAGE_MAX_WIDTH,
  resolveTableGridPresentation,
  resolveTablePageMode,
  useTablePageMode,
} from "./table-page-mode";

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

function TablePageModeProbe() {
  const { mode } = useTablePageMode();
  return createElement("output", null, mode);
}

describe("table page mode", () => {
  it("resolves narrowCards below the narrow breakpoint", () => {
    expect(resolveTablePageMode(NARROW_TABLE_PAGE_MAX_WIDTH - 1)).toBe(
      "narrowCards",
    );
  });

  it("resolves wide at the breakpoint and above", () => {
    expect(resolveTablePageMode(NARROW_TABLE_PAGE_MAX_WIDTH)).toBe("wide");
    expect(resolveTablePageMode(NARROW_TABLE_PAGE_MAX_WIDTH + 1)).toBe("wide");
  });

  it("resolves auto to cards in narrowCards mode", () => {
    expect(
      resolveTableGridPresentation({
        mode: "narrowCards",
        preference: "auto",
      }),
    ).toBe("cards");
  });

  it("resolves auto to tabular in wide mode", () => {
    expect(
      resolveTableGridPresentation({ mode: "wide", preference: "auto" }),
    ).toBe("tabular");
  });

  it("keeps explicit tabular in narrowCards mode", () => {
    expect(
      resolveTableGridPresentation({
        mode: "narrowCards",
        preference: "tabular",
      }),
    ).toBe("tabular");
  });

  it("keeps explicit cards in wide mode", () => {
    expect(
      resolveTableGridPresentation({ mode: "wide", preference: "cards" }),
    ).toBe("cards");
  });

  it("starts mobile client mode as narrowCards below the narrow breakpoint", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: NARROW_TABLE_PAGE_MAX_WIDTH - 1,
    });

    const mounted = await render(createElement(TablePageModeProbe));

    try {
      expect(mounted.container.textContent).toBe("narrowCards");
    } finally {
      await unmount(mounted.root, mounted.container);
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });
});
