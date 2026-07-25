import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  resolveGettingStartedEnv,
  type GettingStartedEnv,
} from "./getting-started-env.js";

type SkillInstallPlan = Readonly<{
  command: "npx";
  args: readonly string[];
  displayCommand: string;
}>;

export function sapportaSkillInstallPlan(
  environment: GettingStartedEnv = resolveGettingStartedEnv(),
): SkillInstallPlan {
  const args = [
    "skills",
    "add",
    environment.skillSource,
    "--skill",
    "sapporta",
  ] as const;
  return {
    command: "npx",
    args,
    displayCommand: ["npx", ...args].map(shellQuote).join(" "),
  };
}

function installCommandBlock(
  projectDir: string,
  plan: SkillInstallPlan,
): string {
  return [`  cd ${shellQuote(projectDir)}`, `  ${plan.displayCommand}`].join(
    "\n",
  );
}

export async function ensureSapportaSkillInstalled(
  projectDir: string,
): Promise<string> {
  const installedSkillPaths = [
    join(projectDir, ".agents", "skills", "sapporta", "SKILL.md"),
    join(homedir(), ".agents", "skills", "sapporta", "SKILL.md"),
    join(homedir(), ".codex", "skills", "sapporta", "SKILL.md"),
  ];
  if (installedSkillPaths.some((path) => existsSync(path))) {
    return (
      "Sapporta skill is already installed. " +
      "You can use it with /sapporta from coding agents to build Sapporta applications."
    );
  }

  const plan = sapportaSkillInstallPlan();
  if (!input.isTTY || !output.isTTY) {
    return [
      "Sapporta skill is not installed.",
      "To install it later, run:",
      installCommandBlock(projectDir, plan),
    ].join("\n");
  }

  const rl = createInterface({ input, output });
  let answer: string;
  try {
    answer = await rl.question(
      [
        "Sapporta skill is not installed.",
        "Install it now? We'll run:",
        installCommandBlock(projectDir, plan),
        "Proceed? [Y/n] ",
      ].join("\n"),
    );
  } finally {
    rl.close();
  }

  const confirmed = answer.trim() === "" || /^y(es)?$/i.test(answer.trim());
  if (!confirmed) {
    return [
      "Sapporta skill was not installed.",
      "You can install it later with:",
      installCommandBlock(projectDir, plan),
    ].join("\n");
  }

  const result = spawnSync(plan.command, [...plan.args], {
    cwd: projectDir,
    stdio: "inherit",
  });
  if (result.error) {
    return [
      `Sapporta skill installation failed: ${result.error.message}`,
      "You can retry with:",
      installCommandBlock(projectDir, plan),
    ].join("\n");
  }
  if (result.status !== 0) {
    return [
      `Sapporta skill installation exited with status ${result.status ?? `signal ${result.signal}`}.`,
      "You can retry with:",
      installCommandBlock(projectDir, plan),
    ].join("\n");
  }

  return (
    "Sapporta skill installed. " +
    "You can use it with /sapporta from coding agents to build Sapporta applications."
  );
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
