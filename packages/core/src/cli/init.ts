import { resolve } from "node:path";
import { OperationError, type OperationResult } from "../introspect/types.js";
import { createProject } from "./init-project/create-project.js";
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
    if (err instanceof OperationError) {
      return {
        ok: false,
        error: err.message,
        code: err.code,
      };
    }
    throw err;
  }
}
