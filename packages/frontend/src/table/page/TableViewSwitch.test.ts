// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableViewSwitch } from "./TableViewSwitch";
import {
  normalizeTableViewPreference,
  tableViewPreferenceKey,
} from "./table-view-pref";

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

describe("TableViewSwitch", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
  });

  it("opens table view options and reports selection changes", async () => {
    const onChange = vi.fn();
    mounted = await render(
      createElement(TableViewSwitch, { value: "auto", onChange }),
    );

    const trigger = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open table view options"]',
    );
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error("expected table view menu trigger");
    }

    expect(trigger.textContent?.trim()).toBe("");
    expect(trigger.title).toBe("View options");

    await act(async () => {
      trigger.click();
    });

    const viewButtons = [...document.body.querySelectorAll("button")].filter(
      (button) => button.getAttribute("role") === "menuitemradio",
    );

    expect(viewButtons.map((button) => button.textContent?.trim())).toEqual([
      "Auto",
      "Tabular",
      "Cards",
    ]);
    expect(viewButtons[0]?.getAttribute("aria-checked")).toBe("true");

    const cardsButton = viewButtons.find(
      (button) => button.textContent?.trim() === "Cards",
    );
    if (!(cardsButton instanceof HTMLButtonElement)) {
      throw new Error("expected Cards button");
    }

    await act(async () => {
      cardsButton.click();
    });

    expect(onChange).toHaveBeenCalledWith("cards");
  });

  it("uses the documented per-table preference key", () => {
    expect(tableViewPreferenceKey("quotes")).toBe("sapporta:table-view:quotes");
  });

  it("maps saved pre-rename view names to current names", () => {
    expect(normalizeTableViewPreference("grid")).toBe("tabular");
    expect(normalizeTableViewPreference("rows")).toBe("cards");
  });
});
