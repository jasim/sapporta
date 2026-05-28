/**
 * Docker release smoke for generated Sapporta projects.
 *
 * This is opt-in because it requires a Docker daemon and performs a full image
 * build. Run with: pnpm test:e2e:docker
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFrontendRoutes,
  assertProjectHttpApi,
  buildAndRunDockerProject,
  cleanupDockerProject,
  cleanupProject,
  createTempProject,
  prepareDockerReleaseProject,
  rebuildBetterSqlite,
  runDrizzleMigrationCycle,
  scaffoldProject,
  writeTasksSchema,
  type E2eProject,
  type StartedDockerProject,
} from "./harness.js";

const runDocker =
  process.env.SAPPORTA_E2E_DOCKER === "1" ? describe : describe.skip;

runDocker("sapporta init - Docker release", () => {
  let project: E2eProject | undefined;
  let dockerProject: StartedDockerProject | undefined;

  beforeAll(async () => {
    const createdProject = createTempProject();
    project = createdProject;

    await scaffoldProject(createdProject);
    await rebuildBetterSqlite(createdProject);
    writeTasksSchema(createdProject.projectDir);
    // The Docker image applies migrations at boot, so the generated project
    // must contain reviewed Drizzle SQL before the image is built.
    await runDrizzleMigrationCycle(createdProject, "init");
    await prepareDockerReleaseProject(createdProject);
    dockerProject = await buildAndRunDockerProject(
      createdProject,
      "sapporta-e2e",
    );
  }, 600_000);

  afterAll(async () => {
    await cleanupDockerProject(project, dockerProject);
    cleanupProject(project);
  });

  it("serves the generated API from the production image", async () => {
    await assertProjectHttpApi(dockerProject!.baseUrl);
  });

  it("serves the generated frontend from the production image", async () => {
    await assertFrontendRoutes(dockerProject!.baseUrl);
  });
});
