import { basename, resolve } from "node:path";
import { OperationError } from "../errors.js";
import type { OperationResult } from "../introspect/operation-result.js";
import { createProject } from "./init-project/create-project.js";
import { devServerSummaryLines } from "./init-project/dev-ports.js";
import { ensureSapportaSkillInstalled } from "./init-project/sapporta-skill.js";
import {
  logInitDetail,
  logInitSection,
  type ProgressLogger,
} from "./init-project/init-shell.js";

const VALID_DIR_NAME = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/;

const progress: ProgressLogger = (message) => {
  console.error(message);
};

export type InitProjectTarget = Readonly<{
  projectDir: string;
  projectName: string;
}>;

export function resolveInitProjectTarget(
  target: string,
  cwd: string = process.cwd(),
): InitProjectTarget {
  const projectDir = resolve(cwd, target);
  return {
    projectDir,
    projectName: basename(projectDir),
  };
}

export async function init(args: string[]): Promise<OperationResult> {
  const projectTarget = args[0];
  if (!projectTarget) {
    return {
      ok: false,
      error:
        "Usage: sapporta init <target>\n\n  <target> is the project directory to create.",
      code: "MISSING_NAME",
    };
  }
  const { projectDir, projectName } = resolveInitProjectTarget(projectTarget);
  if (!VALID_DIR_NAME.test(projectName)) {
    return {
      ok: false,
      error: `Invalid project name "${projectName}". Use only letters, numbers, hyphens, underscores, and dots. No spaces.`,
      code: "INVALID_NAME",
    };
  }

  try {
    const { devPorts } = createProject({
      dir: projectDir,
      name: projectName,
      progress,
    });
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
          `  cd ${shellQuote(projectDir)}`,
          "  pnpm dev",
          "",
          ...devServerSummaryLines(devPorts),
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

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
