import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ErrorCode, OperationError } from "../../errors.js";
import {
  resolveGettingStartedEnv,
  type GettingStartedEnv,
} from "./getting-started-env.js";

export type SkillInstallPlan = Readonly<{
  command: "npx";
  args: readonly string[];
  displayCommand: string;
}>;

type SkillInstallResult = Readonly<{
  error?: Error;
  status: number | null;
  signal: NodeJS.Signals | null;
}>;

export type EnsureSapportaSkillOptions = Readonly<{
  environment?: GettingStartedEnv;
  isSkillInstalled?: () => boolean;
  isInteractive?: boolean;
  prompt?: (question: string) => Promise<string>;
  runInstall?: (
    plan: SkillInstallPlan,
    projectDir: string,
  ) => SkillInstallResult;
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
    "--global",
    "--yes",
  ] as const;
  return {
    command: "npx",
    args,
    displayCommand: ["npx", ...args].map(shellQuote).join(" "),
  };
}

export async function ensureSapportaSkillInstalled(
  projectDir: string,
  options: EnsureSapportaSkillOptions = {},
): Promise<string> {
  const installedSkillPaths = [
    join(projectDir, ".agents", "skills", "sapporta", "SKILL.md"),
    join(homedir(), ".agents", "skills", "sapporta", "SKILL.md"),
    join(homedir(), ".codex", "skills", "sapporta", "SKILL.md"),
  ];
  const isSkillInstalled =
    options.isSkillInstalled ??
    (() => installedSkillPaths.some((path) => existsSync(path)));
  if (isSkillInstalled()) {
    return (
      "Sapporta skill is already installed. " +
      "You can use it with /sapporta from coding agents to build Sapporta applications."
    );
  }

  const plan = sapportaSkillInstallPlan(options.environment);
  const isInteractive =
    options.isInteractive ?? (input.isTTY === true && output.isTTY === true);

  if (isInteractive) {
    const answer = await (
      options.prompt ??
      ((question: string) => {
        const rl = createInterface({ input, output });
        return rl.question(question).finally(() => rl.close());
      })
    )(
      [
        "Sapporta skill is not installed.",
        "Install it now? We'll run:",
        `  ${plan.displayCommand}`,
        "Proceed? [Y/n] ",
      ].join("\n"),
    );

    const confirmed = answer.trim() === "" || /^y(es)?$/i.test(answer.trim());
    if (!confirmed) {
      throw skillInstallError(
        projectDir,
        plan,
        "Sapporta skill installation was declined.",
      );
    }
  }

  const runInstall =
    options.runInstall ??
    ((installPlan: SkillInstallPlan, cwd: string) =>
      spawnSync(installPlan.command, [...installPlan.args], {
        cwd,
        stdio: "inherit",
      }));
  const result = runInstall(plan, projectDir);
  if (result.error) {
    throw skillInstallError(
      projectDir,
      plan,
      `Sapporta skill installation failed: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw skillInstallError(
      projectDir,
      plan,
      `Sapporta skill installation exited with status ${result.status ?? `signal ${result.signal}`}.`,
    );
  }

  return (
    "Sapporta skill installed. " +
    "You can use it with /sapporta from coding agents to build Sapporta applications."
  );
}

function skillInstallError(
  projectDir: string,
  plan: SkillInstallPlan,
  reason: string,
): OperationError {
  return new OperationError(
    [
      reason,
      `The project was created at ${projectDir}, but the Sapporta skill is required before building it.`,
      "Install the skill by running:",
      `  ${plan.displayCommand}`,
    ].join("\n"),
    ErrorCode.INIT_SETUP_FAILED,
  );
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
