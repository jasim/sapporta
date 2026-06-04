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
} from "@/auth/api/auth-context";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";

export type AuthStatus =
  | "idle"
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unverified"
  | "workspace_required"
  | "error";

export interface AuthState {
  status: AuthStatus;
  context: AuthContextResponse | null;
  bootstrapStatus: AuthBootstrapStatus | null;
  error: string | null;
  load: () => Promise<void>;
  loadBootstrapStatus: () => Promise<void>;
  refresh: () => Promise<void>;
  switchWorkspace: (body: SwitchActiveWorkspaceBody) => Promise<void>;
  logout: () => Promise<void>;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "idle",
  context: null,
  bootstrapStatus: null,
  error: null,
  load: async () => {
    if (get().status === "loading") return;
    set({ status: "loading", error: null });
    try {
      const context = await fetchAuthContext();
      set({
        context,
        status: context.user.emailVerified ? "authenticated" : "unverified",
        error: null,
      });
    } catch (err) {
      set(authFailureState(err));
    }
  },
  loadBootstrapStatus: async () => {
    if (get().bootstrapStatus) return;
    try {
      const bootstrapStatus = await fetchAuthBootstrapStatus();
      set({ bootstrapStatus });
    } catch {
      set({
        bootstrapStatus: {
          userCount: 1,
          workspaceCount: 1,
          isEmpty: false,
        },
      });
    }
  },
  refresh: async () => {
    set({ status: "loading", error: null });
    try {
      const context = await fetchAuthContext();
      set({
        context,
        status: context.user.emailVerified ? "authenticated" : "unverified",
        error: null,
      });
    } catch (err) {
      set(authFailureState(err));
    }
  },
  switchWorkspace: async (body) => {
    const context = await switchActiveWorkspace(body);
    useSchemaStore.getState().reset();
    set({
      context,
      status: context.user.emailVerified ? "authenticated" : "unverified",
      error: null,
    });
  },
  logout: async () => {
    await signOut();
    useSchemaStore.getState().reset();
    set({ status: "unauthenticated", context: null, error: null });
  },
  reset: () =>
    set({
      status: "idle",
      context: null,
      bootstrapStatus: null,
      error: null,
    }),
}));

function authFailureState(err: unknown): Pick<AuthState, "status" | "context" | "error"> {
  const code = errorCode(err);
  if (code === "unauthenticated") {
    return { status: "unauthenticated", context: null, error: null };
  }
  if (code === "email_not_verified") {
    return { status: "unverified", context: null, error: null };
  }
  if (code === "workspace_required") {
    return { status: "workspace_required", context: null, error: null };
  }
  return {
    status: "error",
    context: null,
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
