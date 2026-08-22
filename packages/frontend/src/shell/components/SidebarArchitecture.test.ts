// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AuthContextResponse } from "@sapporta/shared/contracts";
import { useAuthStore } from "../../auth/state/auth-store";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import {
  SIDEBAR_DESKTOP_MEDIA_QUERY,
  SIDEBAR_EXPANDED_PREF_KEY,
  SidebarProvider,
} from "../sidebar-controller";
import { AppShell } from "./AppShell";
import { PageBody, PageFrame } from "./Page";
import { PageHeader } from "./PageHeader";
import { SidebarRegion } from "./SidebarRegion";
import { SidebarShell } from "./SidebarShell";
import { SidebarToggle } from "./SidebarToggle";

const AUTH_CONTEXT = {
  user: {
    id: "user-1",
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
  },
  workspace: {
    id: "workspace-1",
    name: "Owner's Workspace",
    slug: "owners-workspace",
    isOwner: true,
  },
  memberships: [
    {
      id: "member-1",
      workspace: {
        id: "workspace-1",
        name: "Owner's Workspace",
        slug: "owners-workspace",
      },
      role: "owner",
      isOwner: true,
    },
  ],
  role: "owner",
  isOwner: true,
} satisfies AuthContextResponse;

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
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  useSchemaStore.getState().reset();
  useAuthStore.getState().reset();
  vi.unstubAllGlobals();
});

describe("sidebar controller and layout", () => {
  it("reserves desktop width when expanded and zero width when collapsed", async () => {
    installMedia({ desktop: true });
    await renderShell();

    const region = sidebarRegion();
    const mountedSidebar = sidebar();
    const toggle = toggleButton("Collapse sidebar");

    expect(region.dataset.sidebarState).toBe("expanded");
    expect(region.className).toContain("w-[240px]");
    expect(sidebarSurface().className).toContain("static");
    expect(toggle.className).toContain("size-10");
    expect(toggle.getAttribute("aria-controls")).toBe(region.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await click(toggle);

    expect(sidebar()).toBe(mountedSidebar);
    expect(region.dataset.sidebarState).toBe("collapsed");
    expect(region.className).toContain("w-0");
    expect(region.className).not.toContain("w-[240px]");
    expect(sidebarSurface().className).toContain("absolute");
    expect(host.querySelector("[data-sidebar-hover-edge]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(sidebarSurface().hasAttribute("aria-hidden")).toBe(false);
    expect(toggleButton("Expand sidebar").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(window.localStorage.getItem(SIDEBAR_EXPANDED_PREF_KEY)).toBe(
      "false",
    );
  });

  it("restores only the persisted desktop preference", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell();

    expect(sidebarRegion().dataset.sidebarState).toBe("collapsed");
    expect(toggleButton("Expand sidebar")).toBeInstanceOf(HTMLButtonElement);
    expect(
      window.localStorage.getItem("sapporta:sidebar-drawer-open"),
    ).toBeNull();
    expect(window.localStorage.getItem("sapporta:sidebar-peeking")).toBeNull();
  });

  it("leaves desktop hover presentation to CSS without pointer state", async () => {
    const matchMedia = installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell();

    expect(matchMedia).toHaveBeenCalledWith(SIDEBAR_DESKTOP_MEDIA_QUERY);
    expect(matchMedia).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[data-sidebar-hover-edge]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(sidebarSurface().className).not.toContain("transition-transform");
    expect(sidebarSurface().hasAttribute("inert")).toBe(false);
  });

  it("opens the full compact sidebar in a Sheet without persisting drawer state", async () => {
    installMedia({ desktop: false });
    await renderShell();

    const toggle = toggleButton("Open sidebar");
    expect(document.querySelector("[data-sidebar-drawer]")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await click(toggle);

    const drawer = document.querySelector<HTMLElement>("[data-sidebar-drawer]");
    expect(drawer).toBeInstanceOf(HTMLElement);
    expect(drawer?.querySelector("aside")).toBeInstanceOf(HTMLElement);
    expect(toggleButton("Close sidebar").getAttribute("aria-expanded")).toBe(
      "true",
    );

    await click(toggleButton("Close sidebar"));
    expect(toggleButton("Open sidebar").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(window.localStorage.getItem(SIDEBAR_EXPANDED_PREF_KEY)).toBeNull();
  });

  it("keeps a shell-owned toggle available on an unwrapped application page", async () => {
    installMedia({ desktop: false });
    await renderAppShell(
      createElement(
        "article",
        { "data-application-page": true },
        "Application content",
      ),
    );

    const scrollRegion = host.querySelector<HTMLElement>(
      "[data-shell-scroll-region]",
    );
    expect(scrollRegion?.className).toContain("overflow-y-auto");
    expect(host.querySelector("[data-page-header]")).toBeNull();
    expect(host.querySelector("[data-application-page]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(toggleButton("Open sidebar")).toBeInstanceOf(HTMLButtonElement);
  });

  it("leaves navigation out until a visitor has a session", async () => {
    installMedia({ desktop: true });
    await renderAppShell(
      createElement(
        "article",
        { "data-application-page": true },
        "Public content",
      ),
      { signedIn: false },
    );

    expect(host.querySelector("[data-application-page]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(host.querySelector("[data-sidebar-region]")).toBeNull();
    expect(host.querySelector('nav[aria-label="Primary"]')).toBeNull();
    expect(host.querySelector("[data-shell-sidebar-toggle]")).toBeNull();
  });

  it("keeps the desktop control inside the sidebar while it is expanded", async () => {
    installMedia({ desktop: true });
    await renderAppShell(createElement("article", null, "Application content"));

    const collapseToggle = toggleButton("Collapse sidebar");
    expect(
      collapseToggle.closest('[data-sidebar-toggle-location="sidebar"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(collapseToggle.closest("[data-sidebar-surface]")).toBe(
      sidebarSurface(),
    );

    await click(collapseToggle);

    const expandToggle = toggleButton("Expand sidebar");
    expect(
      expandToggle.closest('[data-sidebar-toggle-location="content"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(expandToggle.closest("[data-shell-content]")).toBeInstanceOf(
      HTMLElement,
    );

    await click(expandToggle);

    expect(
      toggleButton("Collapse sidebar").closest(
        '[data-sidebar-toggle-location="sidebar"]',
      ),
    ).toBeInstanceOf(HTMLElement);
  });

  it("lets an immersive page replace the default shell control", async () => {
    installMedia({ desktop: true });
    await renderAppShell(
      createElement(
        "div",
        { "data-immersive-page": true },
        createElement(SidebarToggle),
        createElement("canvas", { "aria-label": "Editor" }),
      ),
      { sidebarToggle: false },
    );

    expect(host.querySelector("[data-shell-sidebar-toggle]")).toBeNull();
    expect(toggleButton("Collapse sidebar")).toBeInstanceOf(HTMLButtonElement);
  });
});

describe("page primitives", () => {
  it("keeps the header fixed as a flex sibling above one scrolling body", async () => {
    installMedia({ desktop: true });
    await renderShell();

    const header = host.querySelector<HTMLElement>("[data-page-header]");
    const body = host.querySelector<HTMLElement>("[data-page-body]");
    const frame = host.querySelector<HTMLElement>("[data-page-frame]");

    expect(frame?.className).toContain("h-full");
    expect(frame?.className).toContain("overflow-hidden");
    expect(header?.className).toContain("shrink-0");
    expect(header?.querySelector("[aria-controls]")).toBeNull();
    expect(body?.className).toContain("min-h-0");
    expect(body?.className).toContain("flex-1");
    expect(body?.className).toContain("overflow-auto");
    expect(toggleButton("Collapse sidebar")).toBeInstanceOf(HTMLButtonElement);
  });
});

async function renderShell(page?: ReactNode): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        SidebarProvider,
        null,
        createElement(
          "div",
          { className: "flex h-screen" },
          createElement(
            SidebarRegion,
            null,
            createElement(
              SidebarShell,
              {
                header: createElement("span", null, "App"),
                footer: createElement("span", null, "Account"),
              },
              createElement("a", { href: "/records" }, "Records"),
            ),
          ),
          createElement(
            "div",
            { "data-shell-content": true, className: "relative flex-1" },
            createElement(
              "div",
              { "data-shell-sidebar-toggle": true },
              createElement(SidebarToggle),
            ),
            createElement(
              "main",
              { "data-shell-scroll-region": true },
              page ??
                createElement(
                  PageFrame,
                  null,
                  createElement(PageHeader, { title: "Records" }),
                  createElement(PageBody, null, "Page content"),
                ),
            ),
          ),
        ),
      ),
    );
  });
  await settleSidebarDrawer();
}

async function renderAppShell(
  page: ReactNode,
  props?: { sidebarToggle?: ReactNode | false; signedIn?: boolean },
): Promise<void> {
  if (props?.signedIn ?? true) {
    useAuthStore.setState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });
  }
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          Routes,
          null,
          createElement(
            Route,
            {
              element: createElement(AppShell, {
                navigation: [],
                showFrameworkNavigation: false,
                sidebarToggle: props?.sidebarToggle,
              }),
            },
            createElement(Route, {
              index: true,
              element: page,
            }),
          ),
        ),
      ),
    );
  });
  await settleSidebarDrawer();
}

// `SidebarRegion` loads the compact drawer on demand, so let that module land
// before asserting on the layout it renders.
async function settleSidebarDrawer(): Promise<void> {
  await act(async () => {
    await import("./SidebarDrawer");
  });
}

function installMedia({ desktop }: { desktop: boolean }) {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === SIDEBAR_DESKTOP_MEDIA_QUERY ? desktop : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })) satisfies typeof window.matchMedia;
  vi.stubGlobal("matchMedia", matchMedia);
  return matchMedia;
}

function sidebarRegion(): HTMLElement {
  const region = host.querySelector<HTMLElement>("[data-sidebar-region]");
  if (!region) throw new Error("Expected a desktop sidebar region.");
  return region;
}

function sidebarSurface(): HTMLElement {
  const surface = host.querySelector<HTMLElement>("[data-sidebar-surface]");
  if (!surface) throw new Error("Expected a desktop sidebar surface.");
  return surface;
}

function sidebar(): HTMLElement {
  const element = host.querySelector<HTMLElement>("aside");
  if (!element) throw new Error("Expected a sidebar.");
  return element;
}

function toggleButton(label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"][aria-controls]`,
  );
  if (!button) throw new Error(`Expected "${label}" button.`);
  return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
}
