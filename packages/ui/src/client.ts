/**
 * Framework UI's typed HTTP client and base-URL plumbing.
 *
 * `uiClient` is built from `uiContract` (declared in
 * `@sapporta/shared/contracts`) and is what every `services/*.ts` file
 * calls. Each method returns the 2xx body directly or throws `ApiError`
 * — the dispatchers expect that shape.
 *
 * Project frontends build their own clients with
 * `createApiClient(theirContract, { baseUrl: getApiBase })` — same
 * factory, same base, no UI-specific state in the contract.
 */

import { uiContract } from "@sapporta/shared/contracts";
import { createApiClient } from "@sapporta/shared/client";

export const API_ORIGIN = import.meta.env.VITE_API_URL ?? "";

const API_BASE = `${API_ORIGIN}/api`;

export function getApiBase(): string {
  return API_BASE;
}

export const uiClient = createApiClient(uiContract, { baseUrl: getApiBase });
