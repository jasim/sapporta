// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ReactNode } from "react";
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
import { AuthGate } from "../../auth/components/AuthGate";
import { useAuthStore } from "../../auth/state/auth-store";
import { AuthAccountMenu } from "../../shell/components/AuthAccountMenu";
import { AppShell } from "../../shell/components/AppShell";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { BootLoader } from "./BootLoader";

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

type FetchCall = {
  path: string;
  method: string;
  body: unknown;
};

type FetchRequest = FetchCall & {
  url: URL;
};

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
  useAuthStore.getState().reset();
  useSchemaStore.getState().reset();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BootLoader", () => {
  it("loads schema and restores an authenticated shell session", async () => {
    const calls = installBootFetch((request) => {
      if (request.path === "/api/auth-context") {
        return jsonResponse(AUTH_CONTEXT);
      }
      return null;
    });

    await renderBootLoader(
      createElement(
        "div",
        null,
        createElement(AuthAccountMenu),
        createElement("span", null, "shell content"),
      ),
    );

    await waitForText("shell content");
    expect(useAuthStore.getState().session).toEqual({
      kind: "authenticated",
      context: AUTH_CONTEXT,
    });
    expect(buttonByTextOrLabel("Open account menu for Owner")).not.toBeNull();
    expect(calls.map((call) => call.path).sort()).toEqual([
      "/api/auth-context",
      "/api/meta/info",
      "/api/meta/tables",
    ]);
  });

  it("settles anonymous visitors as guests and renders public shell content", async () => {
    const calls = installBootFetch((request) => {
      if (request.path === "/api/auth-context") {
        return jsonResponse(
          { error: "Authentication required", code: "unauthenticated" },
          401,
        );
      }
      return null;
    });

    await renderBootLoader(
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { element: createElement(AppShell) },
          createElement(Route, {
            index: true,
            element: createElement(Screen, { label: "public content" }),
          }),
        ),
      ),
    );

    await waitForText("public content");
    expect(useAuthStore.getState().session).toEqual({ kind: "guest" });
    expect(calls.map((call) => call.path)).toEqual(["/api/auth-context"]);
  });

  it("renders public shell content when auth restoration fails", async () => {
    const calls = installBootFetch((request) => {
      if (request.path === "/api/auth-context") {
        return jsonResponse({ error: "Server unavailable" }, 500);
      }
      return null;
    });

    await renderBootLoader(createElement(Screen, { label: "public content" }));

    await waitForText("public content");
    expect(useAuthStore.getState().session).toEqual({
      kind: "failed",
      error: "API error 500",
    });
    expect(calls.map((call) => call.path)).toEqual(["/api/auth-context"]);
  });

  it("lets protected routes show the session error after auth restoration fails", async () => {
    installBootFetch((request) => {
      if (request.path === "/api/auth-context") {
        return jsonResponse({ error: "Server unavailable" }, 500);
      }
      return null;
    });

    await renderBootLoader(
      createElement(
        AuthGate,
        null,
        createElement(Screen, { label: "protected content" }),
      ),
    );

    await waitForText("Could not load your session.");
    expect(host.textContent).not.toContain("protected content");
  });
});

function Screen({ label }: { label: string }) {
  return createElement("div", null, label);
}

async function renderBootLoader(children: ReactNode): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(BootLoader, null, children),
      ),
    );
  });
}

function installBootFetch(
  handler: (
    request: FetchRequest,
  ) => Response | null | Promise<Response | null>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const call: FetchCall = {
        path: url.pathname,
        method: init?.method ?? "GET",
        body: parseRequestBody(init?.body),
      };
      calls.push(call);
      const handled = await handler({ ...call, url });
      if (handled) return handled;
      if (call.path === "/api/meta/tables") {
        return jsonResponse({ tables: [] });
      }
      if (call.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    }),
  );
  return calls;
}

function buttonByTextOrLabel(label: string): HTMLButtonElement | null {
  const buttons = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button"),
  );
  return (
    buttons.find(
      (button) =>
        button.getAttribute("aria-label") === label ||
        button.textContent?.trim() === label,
    ) ?? null
  );
}

async function waitForText(text: string): Promise<void> {
  await waitFor(() => {
    expect(document.body.textContent).toContain(text);
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 1200) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError));
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") {
    return new URL(input, "http://localhost");
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
