/**
 * Sapporta's contract-driven API layer, built on `@sapporta/rest-core` and
 * the Hono adapter in `@sapporta/honest`.
 *
 * One Zod schema per request part (pathParams/query/headers/body) does
 * double duty: it types the handler's `request` AND feeds OpenAPI
 * emission. Response Zod schemas are static-only — they type
 * `ServerInferResponses<typeof route>` and feed the spec, but the
 * adapter does not `.parse()` the handler's body at runtime.
 *
 * Project authors typically only need `initContract` + `TsRestApi`:
 *
 *   import { initContract, TsRestApi } from "@sapporta/server";
 *   const c = initContract();
 *   const listPresets = c.query({ method: "GET", path: "/import-presets", ... });
 *   const api = new TsRestApi();
 *   api.register("listPresets", listPresets, async ({ c, request }) => {
 *     // request.query / request.params / request.body are already parsed
 *     return { status: 200, body: ... };
 *   });
 *   export default api;
 */

export { initContract } from "@sapporta/rest-core";
export type {
  AppRoute,
  AppRouter,
  ServerInferRequest,
  ServerInferResponses,
  ServerInferResponseBody,
} from "@sapporta/rest-core";

export * from "@sapporta/honest";
export * from "./table-contracts.js";
export * from "./mount-tables.js";
export * from "./table-handlers.js";
export * from "./mount-meta.js";
export * from "./meta-handlers.js";
export * from "./report-contracts.js";
export * from "./mount-reports.js";
export * from "./report-handlers.js";

// Note: contract objects (`projectInfoRoute`, `uiContract`, etc.) live in
// `@sapporta/shared/contracts` and are imported from there. They are not
// re-exported by `@sapporta/server` so the contract surface stays
// reachable from frontend bundles without dragging in Node-only modules.
