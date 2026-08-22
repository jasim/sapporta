/**
 * Docker release smoke for generated Sapporta projects.
 *
 * This is opt-in because it requires a Docker daemon and performs a full image
 * build. Run with: pnpm test:e2e:docker
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFrontendRoutes,
  assertProjectHttpApi,
  buildAndRunDockerProject,
  cleanupDockerProject,
  cleanupProject,
  createTempProject,
  generateDrizzleMigration,
  prepareDockerReleaseProject,
  assertBetterSqliteLoads,
  requestJson,
  scaffoldProject,
  waitForDockerHealthy,
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
    await assertBetterSqliteLoads(createdProject);
    writeTasksSchema(createdProject.projectDir);
    // The Docker image applies migrations at boot; before building it, only
    // generate the SQL file for the schema added by this test.
    await generateDrizzleMigration(createdProject, "add_tasks");
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

  /**
   * The image is run the way a deployment runs it: health credentialed, and
   * the app contract left at its unset production default. Both answer 401 to
   * an anonymous caller, and Docker must still call the container healthy —
   * its probe measures whether the process is serving, and a credentialed 401
   * is a serving process. Nothing else in the suite reads that verdict;
   * `waitForDockerServer` polls over HTTP from the host and would pass just as
   * happily against a container Docker considers unhealthy.
   */
  it("stays healthy behind the production auth posture", async () => {
    const health = await requestJson<{ code: string }>(
      dockerProject!.baseUrl,
      "/health",
      { expectedStatus: 401 },
    );
    expect(health.body.code).toBe("unauthenticated");

    const contract = await requestJson<{ code: string }>(
      dockerProject!.baseUrl,
      "/api/openapi.json",
      { expectedStatus: 401 },
    );
    expect(contract.body.code).toBe("unauthenticated");

    await waitForDockerHealthy(project!, dockerProject!.containerId);
  });
});
