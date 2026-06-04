/**
 * Framework UI's typed HTTP client and base-URL plumbing.
 *
 * `uiClient` is built from `uiContract` (declared in
 * `@sapporta/shared/contracts`) and is what the module API files
 * calls. Each method returns the 2xx body directly or throws `ApiError`
 * — the dispatchers expect that shape.
 *
 * Project frontends build their own clients with
 * `createApiClient(theirContract, { baseUrl: getApiBase })` — same
 * factory, same base, no UI-specific state in the contract.
 */

import { uiContract } from "@sapporta/shared/contracts";
import { createApiClient } from "@sapporta/shared/client";
import { API_ORIGIN, getApiBase } from "./base";

export const uiClient = createApiClient(uiContract, {
  baseUrl: getApiBase,
  credentials: "include",
});

export { API_ORIGIN, getApiBase };
