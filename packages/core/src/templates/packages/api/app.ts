/**
 * App-specific routes - the file the programmer edits daily.
 *
 * Mount each `packages/api/app/*.ts` sub-app here. `app` is already scoped to
 * `/api`, so `app.route("/bank", bankApi)` is served at `/api/bank` -
 * don't repeat the `/api` prefix.
 *
 * Mounting is explicit by design: dropping a file in `packages/api/app/` does
 * nothing on its own. Sapporta does not auto-discover routes - your
 * `boot.ts` owns the wiring, and this file is the one place where
 * project routes are declared.
 */
import type {
  ProjectDbConnection,
  SapportaEnv,
  TsRestApi,
} from "@sapporta/server";
import helloApi from "./app/hello.js";
import type { SapportaMailer } from "./mailer.js";

export interface LoadAppOptions {
  conn: ProjectDbConnection;
  mailer: SapportaMailer;
}

export function loadApp(app: TsRestApi<SapportaEnv>, _options: LoadAppOptions) {
  app.route("/", helloApi);
}
