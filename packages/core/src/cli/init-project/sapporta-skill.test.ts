import { describe, expect, it } from "vitest";
import { resolveGettingStartedEnv } from "./getting-started-env.js";
import { sapportaSkillInstallPlan } from "./sapporta-skill.js";

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
      ],
      displayCommand:
        "npx skills add https://github.com/jasim/sapporta-skills --skill sapporta",
    });
  });

  it("quotes a configured filesystem skill source", () => {
    const environment = resolveGettingStartedEnv({
      SAPPORTA_SKILL_SOURCE: "/tmp/configured skills",
    });

    expect(sapportaSkillInstallPlan(environment).displayCommand).toBe(
      "npx skills add '/tmp/configured skills' --skill sapporta",
    );
  });
});
