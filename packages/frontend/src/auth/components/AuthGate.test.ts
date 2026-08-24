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
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { AuthAccountMenu } from "../../shell/components/AuthAccountMenu";
import { useAuthStore, type AuthState } from "../state/auth-store";
import { AuthGate, PublicOnlyGate } from "./AuthGate";
import { AccountProfilePage } from "./AccountProfilePage";
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  VerifyEmailPage,
} from "./AuthPages";
import { ChangePasswordPage } from "./ChangePasswordPage";

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
  useAuthStoreReset();
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

describe("auth route gates", () => {
  it("does not restore auth context from protected route guards", async () => {
    const calls = installFetch(() =>
      jsonResponse({ error: "Unexpected request" }, 500),
    );
    useAuthStoreSetState({ session: { kind: "guest" } });

    await renderRoutes(
      "/tables/tasks",
      createElement(Route, {
        path: "/login",
        element: createElement(Screen, { label: "login page" }),
      }),
      createElement(Route, {
        path: "/tables/tasks",
        element: createElement(
          AuthGate,
          null,
          createElement(Screen, { label: "protected page" }),
        ),
      }),
    );

    await waitForText("login page");
    expect(calls.some((call) => call.path === "/api/auth-context")).toBe(false);
  });

  it("redirects protected routes for unauthenticated, unverified, and workspace-required states", async () => {
    const cases = [
      {
        session: { kind: "guest" },
        expectedText: "login page",
      },
      {
        session: { kind: "unverified" },
        expectedText: "verify email page",
      },
      {
        session: { kind: "workspaceRequired" },
        expectedText: "signup page",
      },
    ] as const;

    for (const testCase of cases) {
      act(() => {
        root.unmount();
      });
      host.innerHTML = "";
      root = createRoot(host);
      useAuthStoreReset();
      useAuthStoreSetState({ session: testCase.session });

      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            { initialEntries: ["/tables/tasks"] },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: "/login",
                element: createElement(Screen, { label: "login page" }),
              }),
              createElement(Route, {
                path: "/verify-email",
                element: createElement(Screen, { label: "verify email page" }),
              }),
              createElement(Route, {
                path: "/signup",
                element: createElement(Screen, { label: "signup page" }),
              }),
              createElement(Route, {
                path: "/tables/tasks",
                element: createElement(
                  AuthGate,
                  null,
                  createElement(Screen, { label: "protected page" }),
                ),
              }),
            ),
          ),
        );
      });

      await waitForText(testCase.expectedText);
      expect(host.textContent).not.toContain("protected page");
    }
  });

  it("sends first visitors from login to signup when the app has no users", async () => {
    const calls = installFetch((request) => {
      if (request.path === "/api/auth-bootstrap") {
        return jsonResponse({
          shouldShowSignUp: true,
        });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    useAuthStoreSetState({ session: { kind: "guest" } });

    await renderPublicGate("/login");

    await waitForText("signup page");
    expect(calls.map((call) => call.path)).toEqual(["/api/auth-bootstrap"]);
  });

  it("keeps regular login when auth bootstrap returns no sign-up signal", async () => {
    const calls = installFetch((request) => {
      if (request.path === "/api/auth-bootstrap") {
        return jsonResponse({});
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    useAuthStoreSetState({ session: { kind: "guest" } });

    await renderPublicGate("/login");

    await waitForText("login page");
    expect(calls.map((call) => call.path)).toEqual(["/api/auth-bootstrap"]);
  });

  it("keeps authenticated visitors out of public login pages", async () => {
    useAuthStoreSetState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });

    await renderPublicGate("/login");

    await waitForText("home page");
  });
});

describe("auth pages", () => {
  it("renders public auth pages without loading protected metadata", async () => {
    const calls = installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse(
          { error: "Authentication required", code: "unauthenticated" },
          401,
        );
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });

    await renderRoutes(
      "/login",
      createElement(Route, {
        path: "/login",
        element: createElement(LoginPage),
      }),
    );

    await waitForText("Sign in");
    expect(inputForLabel("Email")).not.toBeNull();
    expect(inputForLabel("Password")).not.toBeNull();
    expect(calls.map((call) => call.path)).toEqual(["/api/meta/info"]);
    expect(calls.some((call) => call.path === "/api/auth-context")).toBe(false);
    expect(calls.some((call) => call.path === "/api/meta/tables")).toBe(false);
  });

  it("shows login failures without leaving the login page", async () => {
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      if (
        request.path === "/api/auth/sign-in/email" &&
        request.method === "POST"
      ) {
        return jsonResponse({ error: "Invalid email or password" }, 401);
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    await renderAuthPageRoutes("/login");

    await fillInput("Email", "owner@example.test");
    await fillInput("Password", "wrong-password");
    await submitForm();

    await waitForText("Invalid email or password");
    expect(host.textContent).toContain("Sign in");
    expect(host.textContent).not.toContain("home page");
  });

  it("signs in and returns to the app shell", async () => {
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      if (
        request.path === "/api/auth/sign-in/email" &&
        request.method === "POST"
      ) {
        return jsonResponse({ ok: true });
      }
      if (request.path === "/api/auth-context") {
        return jsonResponse(AUTH_CONTEXT);
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    await renderAuthPageRoutes("/login");

    await fillInput("Email", "owner@example.test");
    await fillInput("Password", "correct-horse-battery-staple");
    await submitForm();

    await waitForText("home page");
  });

  it("returns to the page a visitor asked for before signing in", async () => {
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      if (
        request.path === "/api/auth/sign-in/email" &&
        request.method === "POST"
      ) {
        return jsonResponse({ ok: true });
      }
      if (request.path === "/api/auth-context") {
        return jsonResponse(AUTH_CONTEXT);
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    useAuthStoreSetState({ session: { kind: "guest" } });

    await renderRoutes(
      "/tables/tasks",
      createElement(Route, {
        path: "/",
        element: createElement(Screen, { label: "home page" }),
      }),
      createElement(Route, {
        path: "/login",
        element: createElement(LoginPage),
      }),
      createElement(Route, {
        path: "/tables/tasks",
        element: createElement(
          AuthGate,
          null,
          createElement(Screen, { label: "tasks page" }),
        ),
      }),
    );

    await waitForText("Sign in");
    await fillInput("Email", "owner@example.test");
    await fillInput("Password", "correct-horse-battery-staple");
    await submitForm();

    await waitForText("tasks page");
    expect(host.textContent).not.toContain("home page");
  });

  it("creates an account and enters the app when verification is not required", async () => {
    // The server does not require verification: sign-up starts a session and
    // the auth context loads even though the email is unverified.
    const unverifiedContext = {
      ...AUTH_CONTEXT,
      user: { ...AUTH_CONTEXT.user, emailVerified: false },
    };
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      if (
        request.path === "/api/auth/sign-up/email" &&
        request.method === "POST"
      ) {
        expect(request.body).toMatchObject({
          email: "owner@example.test",
          name: "Owner",
          callbackURL: "/",
        });
        return jsonResponse({ ok: true });
      }
      if (request.path === "/api/auth-context") {
        return jsonResponse(unverifiedContext);
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    await renderAuthPageRoutes("/signup");

    await waitForText("Sign up and create your first workspace");
    await fillInput("Name", "Owner");
    await fillInput("Email", "owner@example.test");
    await fillInput("Password", "correct-horse-battery-staple");
    await submitForm();

    await waitForText("home page");
  });

  it("creates an account and navigates to email verification when it is required", async () => {
    // The server requires verification: sign-up succeeds without starting a
    // session, so the auth context request stays unauthenticated.
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      if (
        request.path === "/api/auth/sign-up/email" &&
        request.method === "POST"
      ) {
        return jsonResponse({ ok: true });
      }
      if (request.path === "/api/auth-context") {
        return jsonResponse(
          { error: "Authentication required", code: "unauthenticated" },
          401,
        );
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    await renderAuthPageRoutes("/signup");

    await waitForText("Sign up and create your first workspace");
    await fillInput("Name", "Owner");
    await fillInput("Email", "owner@example.test");
    await fillInput("Password", "correct-horse-battery-staple");
    await submitForm();

    await waitForText("verify email page");
  });

  it("submits forgot-password without exposing whether the account exists", async () => {
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      if (
        request.path === "/api/auth/request-password-reset" &&
        request.method === "POST"
      ) {
        expect(request.body).toEqual({
          email: "owner@example.test",
          redirectTo: "/reset-password",
        });
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    await renderRoutes(
      "/forgot-password",
      createElement(Route, {
        path: "/forgot-password",
        element: createElement(ForgotPasswordPage),
      }),
    );

    await fillInput("Email", "owner@example.test");
    await submitForm();

    await waitForText("If an account exists for that email");
  });

  it("reports reset-password links that are missing a token", async () => {
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    await renderRoutes(
      "/reset-password",
      createElement(Route, {
        path: "/reset-password",
        element: createElement(ResetPasswordPage),
      }),
    );

    await fillInput("Password", "new-correct-horse-battery-staple");
    await submitForm();

    await waitForText("Password reset link is missing a token.");
  });

  it("resends verification email from the verify-email page", async () => {
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      if (
        request.path === "/api/auth/send-verification-email" &&
        request.method === "POST"
      ) {
        expect(request.body).toEqual({
          email: "owner@example.test",
          callbackURL: "/",
        });
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    await renderRoutes(
      "/verify-email?resend=1",
      createElement(Route, {
        path: "/verify-email",
        element: createElement(VerifyEmailPage),
      }),
    );

    await fillInput("Email", "owner@example.test");
    await submitForm();

    await waitForText("Verification email sent.");
  });

  it("points development verification to the development server logs", async () => {
    installFetch((request) => {
      if (request.path === "/api/meta/info") {
        return jsonResponse({ name: "Test Project", slug: "test-project" });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });

    await renderRoutes(
      "/verify-email",
      createElement(Route, {
        path: "/verify-email",
        element: createElement(VerifyEmailPage),
      }),
    );

    await waitForText("Check the development server logs");
  });

  it("logs out from the account menu and returns protected routes to login", async () => {
    installFetch((request) => {
      if (request.path === "/api/auth/sign-out" && request.method === "POST") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    useAuthStoreSetState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });
    useSchemaStore.setState({ loaded: true });
    await renderRoutes(
      "/tables/tasks",
      createElement(Route, {
        path: "/login",
        element: createElement(Screen, { label: "login page" }),
      }),
      createElement(Route, {
        path: "/tables/tasks",
        element: createElement(AuthGate, null, createElement(AuthAccountMenu)),
      }),
    );

    await clickButton("Open account menu for Owner");
    await clickButton("Log out");

    await waitForText("login page");
  });
});

describe("authenticated account pages", () => {
  it("links the account profile to password settings inside the shell", async () => {
    installFetch((request) => {
      if (request.path === "/api/auth-tokens") {
        return jsonResponse({ tokens: [] });
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    useAuthStoreSetState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });

    await renderRoutes(
      "/account/profile",
      createElement(Route, {
        path: "/account/profile",
        element: createElement(AccountProfilePage),
      }),
      createElement(Route, {
        path: "/account/password",
        element: createElement(ChangePasswordPage),
      }),
    );

    await waitForText("Security");
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="/account/password"]',
    );
    expect(link).not.toBeNull();
    expect(link!.getAttribute("role")).toBeNull();
    await act(async () => {
      link!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForText("Enter your current password, then choose a new one.");
    expect(
      host
        .querySelector<HTMLAnchorElement>('a[href="/account/profile"]')
        ?.getAttribute("role"),
    ).toBeNull();
  });

  it("rejects mismatched new passwords before sending a request", async () => {
    const calls = installFetch(() =>
      jsonResponse({ error: "Unexpected request" }, 500),
    );
    useAuthStoreSetState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });
    await renderRoutes(
      "/account/password",
      createElement(Route, {
        path: "/account/password",
        element: createElement(ChangePasswordPage),
      }),
    );

    await fillInput("Current password", "correct-horse-battery-staple");
    await fillInput("New password", "first-new-password");
    await fillInput("Confirm new password", "different-new-password");
    await submitForm();

    await waitForText("New passwords do not match.");
    expect(calls).toEqual([]);
  });

  it("shows Better Auth password errors", async () => {
    installFetch((request) => {
      if (request.path === "/api/auth/change-password") {
        return jsonResponse(
          { code: "INVALID_PASSWORD", message: "Invalid password" },
          400,
        );
      }
      return jsonResponse({ error: "Unexpected request" }, 500);
    });
    useAuthStoreSetState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });
    await renderRoutes(
      "/account/password",
      createElement(Route, {
        path: "/account/password",
        element: createElement(ChangePasswordPage),
      }),
    );

    await fillInput("Current password", "wrong-password");
    await fillInput("New password", "new-correct-horse-battery-staple");
    await fillInput("Confirm new password", "new-correct-horse-battery-staple");
    await submitForm();

    await waitForText("Invalid password");
  });
});

function Screen({ label }: { label: string }) {
  return createElement("div", null, label);
}

async function renderPublicGate(initialPath: string): Promise<void> {
  await renderRoutes(
    initialPath,
    createElement(Route, {
      path: "/",
      element: createElement(Screen, { label: "home page" }),
    }),
    createElement(Route, {
      path: "/login",
      element: createElement(
        PublicOnlyGate,
        null,
        createElement(Screen, { label: "login page" }),
      ),
    }),
    createElement(Route, {
      path: "/signup",
      element: createElement(Screen, { label: "signup page" }),
    }),
  );
}

async function renderAuthPageRoutes(initialPath: string): Promise<void> {
  await renderRoutes(
    initialPath,
    createElement(Route, {
      path: "/",
      element: createElement(Screen, { label: "home page" }),
    }),
    createElement(Route, { path: "/login", element: createElement(LoginPage) }),
    createElement(Route, {
      path: "/signup",
      element: createElement(SignupPage),
    }),
    createElement(Route, {
      path: "/verify-email",
      element: createElement(Screen, { label: "verify email page" }),
    }),
  );
}

async function renderRoutes(
  initialPath: string,
  ...routes: ReactNode[]
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        createElement(Routes, null, ...routes),
      ),
    );
  });
}

async function fillInput(label: string, value: string): Promise<void> {
  const input = inputForLabel(label);
  expect(input, `Expected input for label "${label}"`).not.toBeNull();
  await act(async () => {
    setInputValue(input!, value);
    input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitForm(): Promise<void> {
  const form = host.querySelector<HTMLFormElement>("form");
  expect(form).not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

async function clickButton(label: string): Promise<void> {
  const button = buttonByTextOrLabel(label);
  expect(button, `Expected button "${label}"`).not.toBeNull();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function inputForLabel(labelText: string): HTMLInputElement | null {
  const labels = Array.from(host.querySelectorAll("label"));
  const label = labels.find((item) => item.textContent?.trim() === labelText);
  const id = label?.getAttribute("for");
  if (!id) return null;
  const input = document.getElementById(id);
  return input instanceof HTMLInputElement ? input : null;
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

function installFetch(
  handler: (request: FetchRequest) => Response | Promise<Response>,
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
      return handler({ ...call, url });
    }),
  );
  return calls;
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (valueSetter) {
    valueSetter.call(input, value);
    return;
  }
  input.value = value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function useAuthStoreReset(): void {
  useAuthStore.getState().reset();
}

function useAuthStoreSetState(state: Partial<AuthState>): void {
  useAuthStore.setState(state);
}
