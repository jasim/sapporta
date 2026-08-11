import { create } from "zustand";
import type {
  AuthBootstrapStatus,
  AuthContextResponse,
  SwitchActiveWorkspaceBody,
} from "@sapporta/shared/contracts";
import {
  fetchAuthBootstrapStatus,
  fetchAuthContext,
  signOut,
  switchActiveWorkspace,
} from "../api/auth-context";
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
