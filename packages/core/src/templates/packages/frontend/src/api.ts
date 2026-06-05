// Typed client for this project's own contracts.
//
// Use `getApiBase` so calls work in development through the Vite proxy and in
// production against the deployed API URL.
//
// Each method returns the 2xx body on success and throws `ApiError` on
// non-2xx. Add a client entry each time you ship a new contract in
// `__SLUG__-shared`.
//
// Usage:
//   import { customApi } from "./api";
//   const { message } = await customApi.hello();

import { createApiClient } from "@sapporta/shared/client";
import { getApiBase } from "@sapporta/frontend/platform";
import { helloContract } from "__SLUG__-shared";

export const customApi = createApiClient(helloContract, {
  baseUrl: getApiBase,
});
