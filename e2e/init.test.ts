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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSharedConstantReachedMigration,
  assertSqliteTable,
  assertBetterSqliteLoads,
  assertFrontendRoutes,
  assertProjectHttpApi,
  buildGeneratedProject,
  buildProject,
  cleanupProject,
  createTempProject,
  expectAuthContext,
  readSqliteRows,
  requestJson,
  runDrizzleMigrationCycle,
  runFailingProjectSeed,
  runProjectSeed,
  scaffoldProject,
  signInEmailUser,
  startBuiltServer,
  stopServer,
  writeProjectsSchema,
  writeDirectAccountCreationScript,
  writeSeedScript,
  writeTasksSchema,
  type AuthContextBody,
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
    await assertBetterSqliteLoads(project);
    writeTasksSchema(project.projectDir);
    await buildProject(project, "add_tasks");
    await assertSqliteTable(project, "tasks", [
      "id",
      "title",
      "status",
      "priority",
      "workspace_id",
      "created_at",
      "updated_at",
    ]);
    writeProjectsSchema(project.projectDir);
    await runDrizzleMigrationCycle(project, "add_projects");
    assertSharedConstantReachedMigration(project);
    await assertSqliteTable(project, "projects", [
      "id",
      "name",
      "origin",
      "status",
      "workspace_id",
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
    await assertProjectHttpApi(server!.baseUrl, server!.output);
  });

  it("serves the built frontend shell for app routes", async () => {
    await assertFrontendRoutes(server!.baseUrl);
  });

  it("seeds sample data with `pnpm seed`, with no server or credential", async () => {
    writeSeedScript(project!.projectDir);

    // The seeded workspace takes the machine's zone, and `TZ` is how a
    // machine states it. The id is one the tz database has never renamed, so
    // the assertion below is about which zone was read, not about which of its
    // names this runtime answers with.
    const firstRun = await runProjectSeed(project!, { TZ: "Pacific/Auckland" });
    expect(firstRun).toContain("Seeded 2 tasks.");

    // The account is created by the seed run itself, so a database nobody has
    // signed in to can still be filled.
    const [account] = await readSqliteRows<{ email: string; verified: number }>(
      project!,
      "SELECT email, emailVerified AS verified FROM user WHERE email = ?",
      ["demo@example.com"],
    );
    expect(account).toEqual({ email: "demo@example.com", verified: 1 });

    // The rows carry the workspace stamped from that account. The seed script
    // never writes `workspace_id`, so a value here means the write went through
    // row security rather than around it.
    const seeded = await readSqliteRows<{ title: string; workspace: string }>(
      project!,
      "SELECT title, workspace_id AS workspace FROM tasks WHERE title IN (?, ?) ORDER BY title",
      ["Draft the brief", "Ship it"],
    );
    expect(seeded.map((row) => row.title)).toEqual([
      "Draft the brief",
      "Ship it",
    ]);
    const seededWorkspaces = new Set(seeded.map((row) => row.workspace));
    expect(seededWorkspaces.size).toBe(1);
    const [seededWorkspace] = [...seededWorkspaces];
    expect(seededWorkspace).toMatch(/^[0-9a-f-]{36}$/);

    const [seededCalendar] = await readSqliteRows<{ zone: string }>(
      project!,
      "SELECT timeZone AS zone FROM organization WHERE id = ?",
      [seededWorkspace],
    );
    expect(seededCalendar).toEqual({ zone: "Pacific/Auckland" });

    // A script picks the first workspace its account belongs to, and a browser
    // falls back to the same one when the session has not chosen. For a
    // freshly seeded account those are the same workspace, and they have to be,
    // or the seeded rows would be invisible to the account they were seeded
    // for. The script never signs in over HTTP, so this is the assertion that
    // keeps its shortcut honest.
    const signedIn = await signInEmailUser(project!, server!.baseUrl, {
      email: "demo@example.com",
      password: "demo-password",
    });
    const browserContext = await requestJson<AuthContextBody>(
      server!.baseUrl,
      "/api/auth-context",
      { cookieFile: signedIn.cookieFile, expectedSuccess: true },
    );
    expectAuthContext(browserContext.body, {
      email: "demo@example.com",
      workspaceId: seededWorkspace,
    });

    // Seeding twice is expected to be safe.
    expect(await runProjectSeed(project!)).toContain("Already seeded.");

    // The account is proved, not named. A seed file whose password does not
    // match an address already in the database has to stop, or naming an
    // existing person's address would hand the run that person's rows.
    writeSeedScript(project!.projectDir, "not-the-demo-password");
    const refused = await runFailingProjectSeed(project!);
    expect(refused).toContain("Could not sign in as demo@example.com");

    // The permission is checked by the function that creates the account, not
    // by the script that usually calls it, so a caller that reaches past
    // `openSeedRuntime()` is refused for the same reason.
    writeDirectAccountCreationScript(project!.projectDir);
    const refusedDirect = await runFailingProjectSeed(project!, {
      SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING: "false",
    });
    expect(refusedDirect).toContain("SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING=true");
    expect(refusedDirect).not.toContain("Created the account directly.");
  }, 480_000);
});
