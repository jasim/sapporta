// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useDocumentTheme, useThemeStore } from "./theme-store";

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  useThemeStore.setState({ mode: "light", forcedMode: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function ThemedApp() {
  useDocumentTheme();
  return null;
}

describe("theme store", () => {
  it("leaves the document alone until something applies the theme", () => {
    act(() => useThemeStore.getState().setMode("dark"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("reflects the mode on the document while useDocumentTheme is mounted", () => {
    act(() => root.render(createElement(ThemedApp)));
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => useThemeStore.getState().toggle());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("sapporta:theme")).toBe("dark");
  });

  it("keeps a forced mode whatever is saved or toggled", () => {
    window.localStorage.setItem("sapporta:theme", "dark");
    act(() => useThemeStore.getState().forceMode("light"));
    act(() => root.render(createElement(ThemedApp)));
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => useThemeStore.getState().toggle());
    act(() => useThemeStore.getState().setMode("dark"));
    expect(useThemeStore.getState().mode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => useThemeStore.getState().forceMode(null));
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
