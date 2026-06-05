import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextResponse } from "@sapporta/shared/contracts";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
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
    isOwner: true,
  },
  memberships: [
    {
      id: "member-1",
      workspace: { id: "workspace-1", name: "Acme", slug: "acme" },
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

  it("loads the Sapporta auth context", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(AUTH_CONTEXT)));

    await useAuthStore.getState().load();

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().context?.workspace.id).toBe("workspace-1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth-context",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("maps unauthenticated failures to unauthenticated status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Authentication required", code: "unauthenticated" }, 401),
      ),
    );

    await useAuthStore.getState().load();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useAuthStore.getState().context).toBeNull();
  });

  it("maps auth policy failures to UI auth states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Email verification required", code: "email_not_verified" }, 403),
      ),
    );

    await useAuthStore.getState().load();

    expect(useAuthStore.getState().status).toBe("unverified");
    expect(useAuthStore.getState().context).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Workspace required", code: "workspace_required" }, 403),
      ),
    );

    await useAuthStore.getState().refresh();

    expect(useAuthStore.getState().status).toBe("workspace_required");
    expect(useAuthStore.getState().context).toBeNull();
  });

  it("loads public auth bootstrap status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ userCount: 0, workspaceCount: 0, isEmpty: true }),
      ),
    );

    await useAuthStore.getState().loadBootstrapStatus();

    expect(useAuthStore.getState().bootstrapStatus).toEqual({
      userCount: 0,
      workspaceCount: 0,
      isEmpty: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth-bootstrap",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("treats bootstrap status failures as non-empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "Server unavailable", code: "internal" }, 500),
      ),
    );

    await useAuthStore.getState().loadBootstrapStatus();

    expect(useAuthStore.getState().bootstrapStatus).toEqual({
      userCount: 1,
      workspaceCount: 1,
      isEmpty: false,
    });
  });

  it("records generic auth load failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Server unavailable", code: "internal" }, 500)),
    );

    await useAuthStore.getState().load();

    expect(useAuthStore.getState().status).toBe("error");
    expect(useAuthStore.getState().context).toBeNull();
    expect(useAuthStore.getState().error).toBe("API error 500");
  });

  it("resets loaded metadata after workspace switch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(AUTH_CONTEXT)));
    useSchemaStore.setState({ loaded: true });

    await useAuthStore.getState().switchWorkspace({ workspaceId: "workspace-1" });

    expect(useSchemaStore.getState().loaded).toBe(false);
    expect(useAuthStore.getState().status).toBe("authenticated");
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
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    useAuthStore.setState({
      status: "authenticated",
      context: AUTH_CONTEXT,
      error: "stale",
    });
    useSchemaStore.setState({ loaded: true });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState()).toMatchObject({
      status: "unauthenticated",
      context: null,
      error: null,
    });
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
