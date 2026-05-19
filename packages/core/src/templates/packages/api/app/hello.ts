/**
 * Sample route file. Default-exports a `TsRestApi` instance; mounted by
 * `loadApp()` in `../app.ts` so the `/hello` route below is served at
 * `/api/hello`.
 *
 * `TsRestApi` IS-A Hono sub-app, so `api.use(...)`, `api.get(...)`, and
 * the rest of Hono's surface work here too. `api.register(...)`
 * additionally wires the route into the auto-generated
 * `/api/openapi.json` spec.
 *
 * The contract (`helloContract`) and the `APP_NAME` constant live in the
 * `__SLUG__-shared` workspace package. The frontend imports the same
 * contract via `createApiClient(helloContract)` (see
 * `packages/frontend/src/api.ts`) so request and response shapes can never
 * drift between the two sides.
 *
 * Delete this file (and `packages/frontend/src/api.ts`,
 * `packages/shared/src/contracts/hello.ts`, the `app.route("/", helloApi)` call
 * in `app.ts`) once you have your own routes, or use the trio as a
 * template.
 */
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { APP_NAME, helloContract } from "__SLUG__-shared";

const api = new TsRestApi<SapportaEnv>();

api.register("hello", helloContract.hello, () => ({
  status: 200,
  body: { message: `Hello from ${APP_NAME}` },
}));

export default api;
