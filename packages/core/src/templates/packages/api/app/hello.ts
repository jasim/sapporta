/**
 * Sample custom endpoint.
 *
 * `helloContract` defines the API shared by the server and frontend. This file
 * adds the handler and permission check. `../app.ts` mounts it at `/api/hello`.
 */
import { forbidUnless, TsRestApi, type SapportaEnv } from "@sapporta/server";
import { APP_NAME, helloContract } from "%%SAPPORTA:SLUG%%-shared";

const api = new TsRestApi<SapportaEnv>();

api.register("hello", helloContract.hello, ({ c }) => {
  const auth = c.get("auth");
  forbidUnless(c, auth.ability.can("read", "hello"));

  return {
    status: 200,
    body: { message: `Hello from ${APP_NAME}` },
  };
});

export default api;
