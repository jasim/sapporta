import { resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import type { OperationResult } from "../introspect/types.js";
import { createProject } from "./init-project/create-project.js";
import { fromProjectRoot } from "../project-paths.js";
import { ensureSapportaSkillInstalled } from "./init-project/sapporta-skill.js";
import {
  logInitDetail,
  logInitSection,
  type ProgressLogger,
} from "./init-project/init-progress.js";

const VALID_DIR_NAME = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/;

const progress: ProgressLogger = (message) => {
  console.error(message);
};

export async function init(args: string[]): Promise<OperationResult> {
  const projectName = args[0];
  if (!projectName) {
    return {
      ok: false,
      error:
        "Usage: sapporta init <name>\n\n  <name> is the project directory to create.",
      code: "MISSING_NAME",
    };
  }
  if (!VALID_DIR_NAME.test(projectName)) {
    return {
      ok: false,
      error: `Invalid project name "${projectName}". Use only letters, numbers, hyphens, underscores, and dots. No spaces.`,
      code: "INVALID_NAME",
    };
  }
  const projectDir = resolve(projectName);

  const { apiDir, dataDir, markerPath } = fromProjectRoot(projectDir);

  logInitSection(progress, "Creating the Sapporta project directory");
  logInitDetail(progress, `Project directory: ${projectDir}`);
  mkdirSync(apiDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(markerPath)) {
    logInitDetail(
      progress,
      "Writing sapporta.json so Sapporta tools can recognize the project root",
    );
    writeFileSync(
      markerPath,
      JSON.stringify({ name: projectName }, null, 2) + "\n",
    );
  }

  try {
    createProject({ dir: projectDir, name: projectName, progress });
    logInitSection(progress, "Preparing the Sapporta assistant skill");
    logInitDetail(
      progress,
      "Checking whether the local coding-agent skill is installed",
    );
    const skillMessage = await ensureSapportaSkillInstalled(projectDir);
    return {
      ok: true,
      data: [],
      meta: {
        message: [
          "Done.",
          `Project: ${projectDir}`,
          skillMessage,
          "",
          "*** Ready!",
          "",
          "Your Sapporta project is now ready. Run:",
          `  cd ${projectName}`,
          "  pnpm dev",
          "",
        ].join("\n"),
      },
    };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.startsWith("package.json already exists")
    ) {
      logInitSection(progress, "Preparing the Sapporta assistant skill");
      logInitDetail(
        progress,
        "Project files already exist, so only the assistant skill check will run",
      );
      const skillMessage = await ensureSapportaSkillInstalled(projectDir);
      return {
        ok: true,
        data: [],
        meta: {
          message: [
            `${err.message}. Skipping.`,
            skillMessage,
            "",
            "*** Ready!",
            "",
            "Your Sapporta project is now ready. Run:",
            `  cd ${projectName}`,
            "  pnpm dev",
            "",
          ].join("\n"),
        },
      };
    }
    throw err;
  }
}
