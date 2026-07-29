import { describe, expect, it, vi } from "vitest";
import { ErrorCode, OperationError } from "../../introspect/types.js";
import { resolveGettingStartedEnv } from "./getting-started-env.js";
import {
  ensureSapportaSkillInstalled,
  sapportaSkillInstallPlan,
  type SkillInstallPlan,
} from "./sapporta-skill.js";

describe("sapportaSkillInstallPlan", () => {
  it("uses the published skill source by default", () => {
    expect(sapportaSkillInstallPlan(resolveGettingStartedEnv({}))).toEqual({
      command: "npx",
      args: [
        "skills",
        "add",
        "https://github.com/jasim/sapporta-skills",
        "--skill",
        "sapporta",
        "--global",
        "--yes",
      ],
      displayCommand:
        "npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes",
    });
  });

  it("quotes a configured filesystem skill source", () => {
    const environment = resolveGettingStartedEnv({
      SAPPORTA_SKILL_SOURCE: "/tmp/configured skills",
    });

    expect(sapportaSkillInstallPlan(environment).displayCommand).toBe(
      "npx skills add '/tmp/configured skills' --skill sapporta --global --yes",
    );
  });
});

describe("ensureSapportaSkillInstalled", () => {
  it("installs a missing skill automatically in non-interactive environments", async () => {
    const runInstall = vi.fn(
      (_plan: SkillInstallPlan, _projectDir: string) => ({
        status: 0,
        signal: null,
      }),
    );

    await expect(
      ensureSapportaSkillInstalled("/tmp/my-app", {
        isSkillInstalled: () => false,
        isInteractive: false,
        runInstall,
      }),
    ).resolves.toContain("Sapporta skill installed.");

    expect(runInstall).toHaveBeenCalledOnce();
    expect(runInstall).toHaveBeenCalledWith(
      {
        command: "npx",
        args: [
          "skills",
          "add",
          "https://github.com/jasim/sapporta-skills",
          "--skill",
          "sapporta",
          "--global",
          "--yes",
        ],
        displayCommand:
          "npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes",
      },
      "/tmp/my-app",
    );
  });

  it("asks before installing interactively", async () => {
    const prompt = vi.fn(async () => "");
    const runInstall = vi.fn(() => ({ status: 0, signal: null }));

    await ensureSapportaSkillInstalled("/tmp/my-app", {
      isSkillInstalled: () => false,
      isInteractive: true,
      prompt,
      runInstall,
    });

    expect(prompt).toHaveBeenCalledWith(
      expect.stringContaining(
        "npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes",
      ),
    );
    expect(runInstall).toHaveBeenCalledOnce();
  });

  it("requires the skill before building when interactive installation is declined", async () => {
    const runInstall = vi.fn();

    await expect(
      ensureSapportaSkillInstalled("/tmp/my-app", {
        isSkillInstalled: () => false,
        isInteractive: true,
        prompt: async () => "n",
        runInstall,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Sapporta skill is required before building it.",
      ),
      code: ErrorCode.INIT_SETUP_FAILED,
    } satisfies Partial<OperationError>);
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("returns an actionable error when automatic installation fails", async () => {
    await expect(
      ensureSapportaSkillInstalled("/tmp/my-app", {
        isSkillInstalled: () => false,
        isInteractive: false,
        runInstall: () => ({ status: 1, signal: null }),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        [
          "Sapporta skill installation exited with status 1.",
          "The project was created at /tmp/my-app, but the Sapporta skill is required before building it.",
          "Install the skill by running:",
          "  npx skills add https://github.com/jasim/sapporta-skills --skill sapporta --global --yes",
        ].join("\n"),
      ),
      code: ErrorCode.INIT_SETUP_FAILED,
    } satisfies Partial<OperationError>);
  });
});
