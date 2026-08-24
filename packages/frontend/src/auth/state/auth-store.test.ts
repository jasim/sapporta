import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextResponse } from "@sapporta/shared/contracts";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { useAuthStore } from "./auth-store";

const AUTH_CONTEXT = {
  user: {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
  },
  workspace: {
    id: "workspace-1",
    name: "Acme",
    slug: "acme",
    timeZone: "UTC",
    isOwner: true,
  },
  memberships: [
    {
      id: "member-1",
      workspace: {
        id: "workspace-1",
        name: "Acme",
        slug: "acme",
        timeZone: "UTC",
      },
      role: "owner",
      isOwner: true,
    },
  ],
  role: "owner",
  isOwner: true,
} satisfies AuthContextResponse;

describe("auth store", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useSchemaStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores the Sapporta auth context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(AUTH_CONTEXT)),
    );

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().session).toEqual({
      kind: "authenticated",
      context: AUTH_CONTEXT,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth-context",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("keeps unverified users signed in when the server accepts the session", async () => {
    const unverifiedContext = {
      ...AUTH_CONTEXT,
      user: { ...AUTH_CONTEXT.user, emailVerified: false },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(unverifiedContext)),
    );

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().session).toEqual({
      kind: "authenticated",
      context: unverifiedContext,
    });
  });

  it("maps unauthenticated failures to guest sessions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Authentication required", code: "unauthenticated" },
          401,
        ),
      ),
    );

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().session).toEqual({ kind: "guest" });
  });

  it("maps auth policy failures to session states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Email verification required", code: "email_not_verified" },
          403,
        ),
      ),
    );

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().session).toEqual({ kind: "unverified" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Workspace required", code: "workspace_required" },
          403,
        ),
      ),
    );

    await useAuthStore.getState().reloadSession();

    expect(useAuthStore.getState().session).toEqual({
      kind: "workspaceRequired",
    });
  });

  it("loads public auth bootstrap status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ shouldShowSignUp: true })),
    );

    await useAuthStore.getState().loadBootstrapStatus();

    expect(useAuthStore.getState().bootstrapStatus).toEqual({
      shouldShowSignUp: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth-bootstrap",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("treats bootstrap status failures as regular login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Server unavailable", code: "internal" }, 500),
      ),
    );

    await useAuthStore.getState().loadBootstrapStatus();

    expect(useAuthStore.getState().bootstrapStatus).toEqual({});
  });

  it("records generic auth load failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Server unavailable", code: "internal" }, 500),
      ),
    );

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().session).toEqual({
      kind: "failed",
      error: "API error 500",
    });
  });

  it("resets loaded metadata after workspace switch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(AUTH_CONTEXT)),
    );
    useSchemaStore.setState({ loaded: true });

    await useAuthStore
      .getState()
      .switchWorkspace({ workspaceId: "workspace-1" });

    expect(useSchemaStore.getState().loaded).toBe(false);
    expect(useAuthStore.getState().session).toEqual({
      kind: "authenticated",
      context: AUTH_CONTEXT,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth-context/active-workspace",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ workspaceId: "workspace-1" }),
      }),
    );
  });

  it("logs out and clears auth and schema state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true })),
    );
    useAuthStore.setState({
      session: { kind: "authenticated", context: AUTH_CONTEXT },
    });
    useSchemaStore.setState({ loaded: true });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().session).toEqual({ kind: "guest" });
    expect(useSchemaStore.getState().loaded).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
