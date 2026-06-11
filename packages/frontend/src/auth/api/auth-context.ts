import type {
  AuthBootstrapStatus,
  AuthContextResponse,
  AuthTokenListResponse,
  CreateAuthTokenBody,
  CreateAuthTokenResponse,
  SwitchActiveWorkspaceBody,
} from "@sapporta/shared/contracts";
import { uiClient } from "@/platform/client";
import { fetchApi } from "@/platform/http";

export async function fetchAuthContext(): Promise<AuthContextResponse> {
  return uiClient.getAuthContext();
}

export async function fetchAuthBootstrapStatus(): Promise<AuthBootstrapStatus> {
  return uiClient.getAuthBootstrapStatus();
}

export async function switchActiveWorkspace(
  body: SwitchActiveWorkspaceBody,
): Promise<AuthContextResponse> {
  return uiClient.switchActiveWorkspace({ body });
}

export async function listAuthTokens(): Promise<AuthTokenListResponse> {
  return uiClient.listAuthTokens();
}

export async function createAuthToken(
  body: CreateAuthTokenBody,
): Promise<CreateAuthTokenResponse> {
  return uiClient.createAuthToken({ body });
}

export async function revokeAuthToken(id: string): Promise<void> {
  await uiClient.revokeAuthToken({ params: { id } });
}

export async function signOut(): Promise<void> {
  await fetchApi("/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}
