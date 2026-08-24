import type {
  AuthBootstrapStatus,
  AuthContextResponse,
  AuthTokenListResponse,
  CreateAuthTokenBody,
  CreateAuthTokenResponse,
  SwitchActiveWorkspaceBody,
  UpdateWorkspaceTimeZoneBody,
} from "@sapporta/shared/contracts";
import { fetchApi, fetchApiJson } from "../../platform/http";

export async function fetchAuthContext(): Promise<AuthContextResponse> {
  return fetchApiJson<AuthContextResponse>("/auth-context");
}

export async function fetchAuthBootstrapStatus(): Promise<AuthBootstrapStatus> {
  return fetchApiJson<AuthBootstrapStatus>("/auth-bootstrap");
}

export async function switchActiveWorkspace(
  body: SwitchActiveWorkspaceBody,
): Promise<AuthContextResponse> {
  return fetchApiJson<AuthContextResponse>("/auth-context/active-workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Sets the calendar the active workspace keeps. Owner only.
 *
 * Answers with a fresh auth context, so the caller settles the new session
 * through the same path a workspace switch settles through and the new zone is
 * published with it.
 */
export async function updateWorkspaceTimeZone(
  body: UpdateWorkspaceTimeZoneBody,
): Promise<AuthContextResponse> {
  return fetchApiJson<AuthContextResponse>(
    "/auth-context/workspace/time-zone",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function listAuthTokens(): Promise<AuthTokenListResponse> {
  return fetchApiJson<AuthTokenListResponse>("/auth-tokens");
}

export async function createAuthToken(
  body: CreateAuthTokenBody,
): Promise<CreateAuthTokenResponse> {
  return fetchApiJson<CreateAuthTokenResponse>("/auth-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function revokeAuthToken(id: string): Promise<void> {
  await fetchApi(`/auth-tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}

export async function changePassword(body: ChangePasswordInput): Promise<void> {
  await fetchApi("/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function signOut(): Promise<void> {
  await fetchApi("/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}
