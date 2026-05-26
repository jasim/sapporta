/**
 * End-to-end test for the latest published `sapporta` CLI package.
 *
 * Installs `sapporta` from npm into a temp parent directory, runs the installed
 * bin from node_modules/.bin, then exercises the generated project with the
 * same schema/build/server/curl assertions as the local source E2E.
 *
 * Run with: pnpm test:e2e:npm
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFrontendRoutes,
  assertProjectHttpApi,
  buildProject,
  cleanupProject,
  createTempProject,
  rebuildBetterSqlite,
  scaffoldProjectWithNpmCli,
  startBuiltServer,
  stopServer,
  writeTasksSchema,
  type E2eProject,
  type StartedServer,
} from "./harness.js";

const runNpm =
  process.env.SAPPORTA_E2E_NPM === "1" ? describe : describe.skip;

runNpm("sapporta init from latest npm package - end-to-end", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;

  beforeAll(async () => {
    process.stderr.write(
      "[e2e setup] installing latest npm sapporta and scaffolding a project - expect ~120-240s\n",
    );

    project = createTempProject({
      devMode: false,
      prefix: "sapporta-e2e-npm-",
    });
    await scaffoldProjectWithNpmCli(project);
    await rebuildBetterSqlite(project);
    writeTasksSchema(project.projectDir);
    await buildProject(project);
    server = await startBuiltServer(project);
  }, 480_000);

  afterAll(() => {
    stopServer(server);
    cleanupProject(project);
  });

  it("serves schema metadata and CRUD data through curl", async () => {
    await assertProjectHttpApi(server!.baseUrl);
  });

  it("serves the built frontend shell for app routes", async () => {
    await assertFrontendRoutes(server!.baseUrl);
  });
});
