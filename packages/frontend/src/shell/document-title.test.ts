// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useSchemaStore } from "../schema-catalog/state/schema-store";
import { resetPageTitles, usePageTitle } from "./document-title";
import { PageHeader } from "./components/PageHeader";

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  useSchemaStore.getState().reset();
  resetPageTitles();
  document.title = "Baked App";
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = "";
});

function Titled({ title }: { title?: string | false }) {
  usePageTitle(title);
  return null;
}

function render(children: ReactNode): void {
  act(() => {
    root.render(children);
  });
}

describe("usePageTitle", () => {
  it("combines the page title with the title index.html shipped with", () => {
    render(createElement(Titled, { title: "Invoices" }));
    expect(document.title).toBe("Invoices – Baked App");
  });

  it("switches to the project name when it loads", () => {
    render(createElement(Titled, { title: "Invoices" }));
    act(() => {
      useSchemaStore
        .getState()
        .setProjectInfo({ name: "JBooks", slug: "jbooks" });
    });
    expect(document.title).toBe("Invoices – JBooks");
  });

  it("shows only the app name when the page title matches it", () => {
    render(createElement(Titled, { title: "Baked App" }));
    expect(document.title).toBe("Baked App");
  });

  it("lets the latest declaration win and restores on unmount", () => {
    render(createElement(Titled, { title: "Invoices" }));
    render([
      createElement(Titled, { key: "page", title: "Invoices" }),
      createElement(Titled, { key: "panel", title: "Invoice #42" }),
    ]);
    expect(document.title).toBe("Invoice #42 – Baked App");

    render(createElement(Titled, { key: "page", title: "Invoices" }));
    expect(document.title).toBe("Invoices – Baked App");
  });

  it("updates a covered declaration without moving it on top", () => {
    render([
      createElement(Titled, { key: "page", title: "Invoices" }),
      createElement(Titled, { key: "panel", title: "Invoice #42" }),
    ]);
    render([
      createElement(Titled, { key: "page", title: "Payments" }),
      createElement(Titled, { key: "panel", title: "Invoice #42" }),
    ]);
    expect(document.title).toBe("Invoice #42 – Baked App");

    render(createElement(Titled, { key: "page", title: "Payments" }));
    expect(document.title).toBe("Payments – Baked App");
  });

  it("declares nothing for a false title", () => {
    render(createElement(Titled, { title: false }));
    expect(document.title).toBe("Baked App");
  });
});

describe("PageHeader document title", () => {
  it("names the tab after its title", () => {
    render(createElement(PageHeader, { title: "Reports" }));
    expect(document.title).toBe("Reports – Baked App");
  });

  it("can use a separate tab title", () => {
    render(
      createElement(PageHeader, {
        title: "Reports",
        documentTitle: "Monthly reports",
      }),
    );
    expect(document.title).toBe("Monthly reports – Baked App");
  });

  it("stays quiet when opted out", () => {
    render(createElement(PageHeader, { title: "Panel", documentTitle: false }));
    expect(document.title).toBe("Baked App");
  });
});
