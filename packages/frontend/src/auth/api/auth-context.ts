import type {
  AuthBootstrapStatus,
  AuthContextResponse,
  AuthTokenListResponse,
  CreateAuthTokenBody,
  CreateAuthTokenResponse,
  SwitchActiveWorkspaceBody,
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
