import { create } from "zustand";
import type {
  AuthBootstrapStatus,
  AuthContextResponse,
  SwitchActiveWorkspaceBody,
  UpdateWorkspaceTimeZoneBody,
} from "@sapporta/shared/contracts";
import {
  fetchAuthBootstrapStatus,
  fetchAuthContext,
  signOut,
  switchActiveWorkspace,
  updateWorkspaceTimeZone,
} from "../api/auth-context";
import { setAppTimeZone } from "../../platform/app-time-zone";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";

export type AuthSession =
  | { kind: "unknown" }
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "authenticated"; context: AuthContextResponse }
  | { kind: "unverified" }
  | { kind: "workspaceRequired" }
  | { kind: "failed"; error: string };

export interface AuthState {
  session: AuthSession;
  bootstrapStatus: AuthBootstrapStatus | null;
  restoreSession: () => Promise<void>;
  reloadSession: () => Promise<void>;
  loadBootstrapStatus: () => Promise<void>;
  switchWorkspace: (body: SwitchActiveWorkspaceBody) => Promise<void>;
  setWorkspaceTimeZone: (body: UpdateWorkspaceTimeZoneBody) => Promise<void>;
  logout: () => Promise<void>;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: { kind: "unknown" },
  bootstrapStatus: null,
  restoreSession: async () => {
    const kind = get().session.kind;
    if (kind !== "unknown" && kind !== "failed") return;
    set({ session: { kind: "loading" } });
    set({ session: await readAuthSession() });
  },
  reloadSession: async () => {
    if (get().session.kind === "loading") return;
    set({ session: { kind: "loading" } });
    set({ session: await readAuthSession() });
  },
  loadBootstrapStatus: async () => {
    if (get().bootstrapStatus) return;
    try {
      const bootstrapStatus = await fetchAuthBootstrapStatus();
      set({ bootstrapStatus });
    } catch {
      set({
        bootstrapStatus: {},
      });
    }
  },
  switchWorkspace: async (body) => {
    const context = await switchActiveWorkspace(body);
    useSchemaStore.getState().reset();
    set({ session: sessionFromContext(context) });
  },
  setWorkspaceTimeZone: async (body) => {
    const context = await updateWorkspaceTimeZone(body);
    // Every screen on the way out was written on the previous clock, and
    // rebuilding them in place would mean threading the zone through every
    // path that renders a moment as a live value. Resetting the schema store
    // closes the `BootLoader` gate instead, so each route remounts against the
    // zone `sessionFromContext` is about to publish. This is the same handling
    // a workspace switch gets, for the same reason.
    useSchemaStore.getState().reset();
    set({ session: sessionFromContext(context) });
  },
  logout: async () => {
    await signOut();
    useSchemaStore.getState().reset();
    set({ session: { kind: "guest" } });
  },
  reset: () =>
    set({
      session: { kind: "unknown" },
      bootstrapStatus: null,
    }),
}));

async function readAuthSession(): Promise<AuthSession> {
  try {
    const context = await fetchAuthContext();
    return sessionFromContext(context);
  } catch (err) {
    return sessionFromAuthFailure(err);
  }
}

function sessionFromContext(context: AuthContextResponse): AuthSession {
  // The zone the active workspace keeps is published before the session is
  // handed on, so it is in place before `BootLoader` opens and no screen can
  // render a timestamp without one. Both ways a session settles — restoring it
  // and switching workspaces — come through here, so switching to a workspace
  // on a different calendar publishes the new one along with the new
  // workspace.
  setAppTimeZone(context.workspace.timeZone);
  // The server decides whether verification blocks access: when the app
  // requires it, the context request fails with `email_not_verified` and the
  // session becomes "unverified". A successful response is a usable session
  // even while `user.emailVerified` is false.
  return { kind: "authenticated", context };
}

function sessionFromAuthFailure(err: unknown): AuthSession {
  const code = errorCode(err);
  if (code === "unauthenticated") {
    return { kind: "guest" };
  }
  if (code === "email_not_verified") {
    return { kind: "unverified" };
  }
  if (code === "workspace_required") {
    return { kind: "workspaceRequired" };
  }
  return {
    kind: "failed",
    error: err instanceof Error ? err.message : String(err),
  };
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const body = "body" in err ? err.body : undefined;
  if (!body || typeof body !== "object") return undefined;
  const code = "code" in body ? body.code : undefined;
  return typeof code === "string" ? code : undefined;
}
