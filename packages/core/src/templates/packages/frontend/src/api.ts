// Typed client for this project's own contracts.
//
// `createApiClient` lives in `@sapporta/shared/client` (browser-safe,
// runtime-neutral). `getApiBase` is the dynamic-base getter the
// framework frontend uses for `/meta/*` and `/tables/*`; reusing it here
// keeps this client pointed at the same base.
//
// Each method returns the 2xx body on success and throws `ApiError` on
// non-2xx. Add one entry to the router each time you ship a new
// contract in `__SLUG__-shared`.
//
// Usage:
//   import { customApi } from "./api";
//   const { message } = await customApi.hello();

import { createApiClient } from "@sapporta/shared/client";
import { getApiBase } from "@sapporta/frontend";
import { helloContract } from "__SLUG__-shared";

export const customApi = createApiClient(helloContract, { baseUrl: getApiBase });
