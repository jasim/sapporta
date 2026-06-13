/**
 * PUBLIC API SAMPLE
 *
 * This route is intentionally allow-listed in `../app.ts`, so anonymous
 * visitors can call it. Do not return user, workspace, customer, financial, or
 * internal data from public routes unless the feature is explicitly meant to
 * expose that data.
 *
 * Public does not mean unguarded: keep the CASL check below, and use
 * `auth.rowSecurity.forTable(table).ownedRows(...)` for any table-backed
 * public data.
 */
import { forbidUnless, TsRestApi, type SapportaEnv } from "@sapporta/server";
import { APP_NAME, publicApiSampleContract } from "%%SAPPORTA:SLUG%%-shared";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "publicApiSample",
  publicApiSampleContract.publicApiSample,
  ({ c }) => {
    const auth = c.get("auth");
    forbidUnless(c, auth.ability.can("read", "public_api_sample"));

    return {
      status: 200,
      body: {
        message: `${APP_NAME} public API sample`,
      },
    };
  },
);

export default api;
