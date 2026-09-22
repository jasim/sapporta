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
  useSidebar,
} from "../sidebar-controller";
import { Receipt } from "lucide-react";
import type { Navigation } from "../navigation";
import { AppShell } from "./AppShell";
import { PageBody, PageFrame } from "./Page";
import { PageHeader } from "./PageHeader";
import {
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
  SIDEBAR_RAIL_WIDTH,
  SidebarRegion,
} from "./SidebarRegion";
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
    timeZone: "UTC",
    isOwner: true,
  },
  memberships: [
    {
      id: "member-1",
      workspace: {
        id: "workspace-1",
        name: "Owner's Workspace",
        slug: "owners-workspace",
        timeZone: "UTC",
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
  vi.useRealTimers();
});

describe("sidebar controller and layout", () => {
  it("reserves the sidebar's width when expanded and the rail's when collapsed", async () => {
    installMedia({ desktop: true });
    await renderShell();

    const region = sidebarRegion();
    const mountedSidebar = sidebar();
    const toggle = toggleButton("Collapse sidebar");

    expect(region.dataset.sidebarState).toBe("expanded");
    // The region takes the width of what it holds; the shell sets 240px.
    expect(region.style.width).toBe("");
    expect(mountedSidebar.className).toContain("w-[240px]");
    expect(sidebarSurface().className).not.toContain("absolute");
    expect(toggle.className).toContain("size-10");
    expect(toggle.getAttribute("aria-controls")).toBe(region.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await click(toggle);

    expect(sidebar()).toBe(mountedSidebar);
    expect(region.dataset.sidebarState).toBe("collapsed");
    expect(region.style.width).toBe(SIDEBAR_RAIL_WIDTH);
    expect(sidebarSurface().className).toContain("absolute");
    expect(sidebarSurface().style.width).toBe(SIDEBAR_RAIL_WIDTH);
    expect(mountedSidebar.className).toContain("w-full");
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

  it("opens the collapsed sidebar over the page while the mouse rests on the rail", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell();
    vi.useFakeTimers();

    await pointerEnter(sidebarSurface());
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS - 1);
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();

    await advance(1);
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");
    // The page keeps its place: only the rail's width stays in the layout.
    expect(sidebarRegion().style.width).toBe(SIDEBAR_RAIL_WIDTH);
    expect(sidebarSurface().style.width).toBe("");
    expect(sidebar().className).toContain("w-[240px]");
    expect(window.localStorage.getItem(SIDEBAR_EXPANDED_PREF_KEY)).toBe(
      "false",
    );

    await pointerLeave(sidebarSurface());
    await advance(SIDEBAR_PEEK_CLOSE_DELAY_MS - 1);
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");

    await advance(1);
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();
    expect(sidebar().className).toContain("w-full");
  });

  it("keeps the sidebar closed under the pointer that just collapsed it", async () => {
    installMedia({ desktop: true });
    await renderAppShell(createElement("article", null, "Application content"));
    vi.useFakeTimers();

    await pointerEnter(sidebarSurface());
    const toggle = toggleButton("Collapse sidebar");
    await pointerDown(toggle);
    await click(toggle);
    // Pressing swaps the control's icon, and a browser reports the pointer
    // entering the new icon as if from outside the page.
    await pointerEnter(toggle.querySelector("svg") ?? toggle);
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS * 5);

    expect(sidebarRegion().dataset.sidebarState).toBe("collapsed");
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();

    // Once the pointer has left, coming back to rest opens it again.
    await pointerLeave(sidebarSurface());
    await pointerEnter(sidebarSurface());
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS);
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");
  });

  it("follows a press on the rail without opening the sidebar", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell();
    vi.useFakeTimers();

    await pointerEnter(sidebarSurface());
    await pointerDown(sidebar());
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS * 5);
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();

    await pointerEnter(sidebarSurface(), "touch");
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS * 5);
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();
  });

  it("docks the sidebar when its control is pressed while open over the page", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderShell();
    vi.useFakeTimers();

    await pointerEnter(sidebarSurface());
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS);
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");

    await click(toggleButton("Expand sidebar"));
    expect(sidebarRegion().dataset.sidebarState).toBe("expanded");
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();

    // Collapsing again starts from the rail, not from the open sidebar.
    await click(toggleButton("Collapse sidebar"));
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();
    expect(sidebar().className).toContain("w-full");
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

  it("keeps the desktop control in the same place in the sidebar and the rail", async () => {
    installMedia({ desktop: true });
    await renderAppShell(createElement("article", null, "Application content"));

    const toggle = toggleButton("Collapse sidebar");
    const header = toggle.closest('[data-sidebar-toggle-location="sidebar"]');
    expect(header).toBeInstanceOf(HTMLElement);
    expect(header?.parentElement?.firstElementChild).toBe(header);
    expect(toggle.closest("[data-sidebar-surface]")).toBe(sidebarSurface());

    toggle.focus();
    await click(toggle);

    // The same button, still first in the sidebar header, keeps focus.
    expect(toggleButton("Expand sidebar")).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(host.querySelector('[data-sidebar-toggle-location="content"]')).toBe(
      null,
    );
    expect(
      host.querySelector<HTMLElement>("[data-shell-scroll-region]")?.className,
    ).not.toContain("--sap-page-header-inset");

    await click(toggle);

    expect(toggleButton("Collapse sidebar")).toBe(toggle);
  });

  it("returns to the rail when a destination is chosen", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderAppShell(
      createElement("article", null, "Application content"),
      {
        navigation: [
          {
            label: "Records",
            items: [{ label: "Invoices", to: "/invoices", icon: Receipt }],
          },
        ],
      },
    );
    vi.useFakeTimers();

    await pointerEnter(sidebarSurface());
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS);
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");

    const link = host.querySelector<HTMLAnchorElement>('a[href="/invoices"]');
    if (!link) throw new Error("Expected a link to /invoices.");
    await pointerDown(link);
    await act(async () => link.click());

    // The page is clear at once, and the pointer resting where the sidebar was
    // does not bring it back.
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS * 5);
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();

    await pointerLeave(sidebarSurface());
    await pointerEnter(sidebarSurface());
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS);
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");
  });

  it("returns to the rail when an account menu item is chosen", async () => {
    installMedia({ desktop: true });
    window.localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, "false");
    await renderAppShell(createElement("article", null, "Application content"));
    vi.useFakeTimers();

    await pointerEnter(sidebarSurface());
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS);
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");

    const account = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Open account menu for Owner"]',
    );
    if (!account) throw new Error("Expected the account menu trigger.");
    await pointerDown(account);
    await click(account);

    // Opening the menu is not choosing anything: the sidebar stays open.
    expect(sidebarRegion().dataset.sidebarPeek).toBe("open");

    const profile = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.startsWith("Profile"));
    if (!profile) throw new Error("Expected the Profile action.");
    await click(profile);

    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();
    await advance(SIDEBAR_PEEK_OPEN_DELAY_MS * 5);
    expect(sidebarRegion().dataset.sidebarPeek).toBeUndefined();
  });

  it("shows only icons, the control, and the avatar in the rail", async () => {
    installMedia({ desktop: true });
    await renderAppShell(
      createElement("article", null, "Application content"),
      {
        navigation: [
          {
            label: "Records",
            items: [{ label: "Invoices", to: "/invoices", icon: Receipt }],
          },
        ],
      },
    );

    const link = host.querySelector<HTMLAnchorElement>('a[href="/invoices"]');
    const label = [...(link?.querySelectorAll("span") ?? [])].find(
      (span) => span.textContent === "Invoices",
    );
    const account = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Open account menu for Owner"]',
    );
    expect(label?.className).not.toContain("sr-only");
    expect(host.querySelector("aside")?.textContent).toContain("Your app");
    expect(account?.querySelector("svg")).toBeInstanceOf(SVGElement);

    await click(toggleButton("Collapse sidebar"));

    // The label stays in the link for assistive technology.
    expect(label?.className).toContain("sr-only");
    expect(link?.textContent).toContain("Invoices");
    expect(host.querySelector("aside")?.textContent).not.toContain("Your app");
    expect(account?.querySelector("svg")).toBeNull();
    expect(account?.lastElementChild?.className).toContain("invisible");
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
          createElement(SidebarRegion, null, createElement(RecordsSidebar)),
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

function RecordsSidebar() {
  const { rail } = useSidebar();
  return createElement(
    SidebarShell,
    {
      rail,
      header: createElement("span", null, "App"),
      footer: createElement("span", null, "Account"),
    },
    createElement("a", { href: "/records" }, "Records"),
  );
}

async function renderAppShell(
  page: ReactNode,
  props?: {
    sidebarToggle?: ReactNode | false;
    signedIn?: boolean;
    navigation?: Navigation;
  },
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
                navigation: props?.navigation ?? [],
                showFrameworkNavigation: false,
                sidebarToggle: props?.sidebarToggle,
              }),
            },
            createElement(Route, {
              index: true,
              element: page,
            }),
            // Choosing a destination keeps the shell: every path renders it.
            createElement(Route, {
              path: "*",
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

// React derives enter and leave from `pointerover` and `pointerout`, using the
// element the pointer came from or went to.
async function pointerEnter(
  element: Element,
  pointerType: "mouse" | "touch" = "mouse",
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType,
        relatedTarget: document.body,
      }),
    );
  });
}

async function pointerLeave(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: document.body,
      }),
    );
  });
}

async function pointerDown(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
