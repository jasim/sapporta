// Typed browser clients for the application's custom APIs.
//
// Each client uses the same contract as its server handler. `getApiBase` picks
// the local or deployed API URL. Methods return the 2xx body and throw
// `ApiError` for other responses.
//
// Usage:
//   import { customApi } from "./api";
//   const { message } = await customApi.hello();

import { createApiClient } from "@sapporta/shared/client";
import { getApiBase } from "@sapporta/frontend/platform";
import {
  helloContract,
  publicApiSampleContract,
} from "%%SAPPORTA:SLUG%%-shared";

export const customApi = createApiClient(helloContract, {
  baseUrl: getApiBase,
});

export const publicApi = createApiClient(publicApiSampleContract, {
  baseUrl: getApiBase,
});
