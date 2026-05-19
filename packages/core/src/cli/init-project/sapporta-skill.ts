import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SAPPORTA_SKILL_PATH = join(homedir(), ".agents", "skills", "sapporta", "SKILL.md");
const INSTALL_COMMAND = "npx skills add https://github.com/jasim/sapporta-skills --skill sapporta";
const INSTALL_ARGS = ["skills", "add", "https://github.com/jasim/sapporta-skills", "--skill", "sapporta"];

function installCommandBlock(projectDir: string): string {
  return [`  cd ${projectDir}`, `  ${INSTALL_COMMAND}`].join("\n");
}

export async function ensureSapportaSkillInstalled(projectDir: string): Promise<string> {
  if (existsSync(SAPPORTA_SKILL_PATH)) {
    return (
      "Sapporta skill is already installed. " +
      "You can use it with /sapporta from coding agents to build Sapporta applications."
    );
  }

  if (!input.isTTY || !output.isTTY) {
    return [
      "Sapporta skill is not installed.",
      "To install it later, run:",
      installCommandBlock(projectDir),
    ].join("\n");
  }

  const rl = createInterface({ input, output });
  let answer: string;
  try {
    answer = await rl.question(
      [
        "Sapporta skill is not installed.",
        "Install it now? We'll run:",
        installCommandBlock(projectDir),
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
      installCommandBlock(projectDir),
    ].join("\n");
  }

  const result = spawnSync("npx", INSTALL_ARGS, { cwd: projectDir, stdio: "inherit" });
  if (result.error) {
    return [
      `Sapporta skill installation failed: ${result.error.message}`,
      "You can retry with:",
      installCommandBlock(projectDir),
    ].join("\n");
  }
  if (result.status !== 0) {
    return [
      `Sapporta skill installation exited with status ${result.status ?? `signal ${result.signal}`}.`,
      "You can retry with:",
      installCommandBlock(projectDir),
    ].join("\n");
  }

  return (
    "Sapporta skill installed. " +
    "You can use it with /sapporta from coding agents to build Sapporta applications."
  );
}
