/**
 * End-to-end test for `sapporta init`.
 *
 * Exercises a real generated project: scaffold -> add schema -> install native
 * bindings -> production build -> boot server -> seed/read data through curl ->
 * serve the built frontend shell. Runs against a real temp directory with no
 * mocked Sapporta internals.
 *
 * Run with: pnpm test:e2e
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertSqliteTable,
  assertFrontendRoutes,
  assertProjectHttpApi,
  buildGeneratedProject,
  buildProject,
  cleanupProject,
  createTempProject,
  rebuildBetterSqlite,
  runDrizzleMigrationCycle,
  scaffoldProject,
  startBuiltServer,
  stopServer,
  writeProjectsSchema,
  writeTasksSchema,
  type E2eProject,
  type StartedServer,
} from "./harness.js";

describe("sapporta init - end-to-end", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;

  beforeAll(async () => {
    process.stderr.write(
      "[e2e setup] scaffolding a full project on a real filesystem - expect ~90-150s\n",
    );

    project = createTempProject();
    await scaffoldProject(project);
    await rebuildBetterSqlite(project);
    writeTasksSchema(project.projectDir);
    await buildProject(project);
    await assertSqliteTable(project, "tasks", [
      "id",
      "title",
      "status",
      "priority",
      "created_at",
      "updated_at",
    ]);
    writeProjectsSchema(project.projectDir);
    await runDrizzleMigrationCycle(project, "add_projects");
    await assertSqliteTable(project, "projects", [
      "id",
      "name",
      "status",
      "created_at",
      "updated_at",
    ]);
    await buildGeneratedProject(project);
    server = await startBuiltServer(project);
  }, 420_000);

  afterAll(() => {
    stopServer(server);
    cleanupProject(project);
  });

  it("serves schema metadata and CRUD data through curl", async () => {
    await assertProjectHttpApi(server!.baseUrl);
  });

  it("applies generated Drizzle migrations to the SQLite database", async () => {
    await assertSqliteTable(project!, "tasks", [
      "id",
      "title",
      "status",
      "priority",
      "created_at",
      "updated_at",
    ]);
    await assertSqliteTable(project!, "projects", [
      "id",
      "name",
      "status",
      "created_at",
      "updated_at",
    ]);
  });

  it("serves the built frontend shell for app routes", async () => {
    await assertFrontendRoutes(server!.baseUrl);
  });
});
