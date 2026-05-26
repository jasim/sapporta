import { resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import type { OperationResult } from "../introspect/types.js";
import { createProject } from "./init-project/create-project.js";
import { fromProjectRoot } from "../project-paths.js";
import { ensureSapportaSkillInstalled } from "./init-project/sapporta-skill.js";

const VALID_DIR_NAME = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/;

function progress(message: string): void {
  console.error(message);
}

export async function init(args: string[]): Promise<OperationResult> {
  const projectName = args[0];
  if (!projectName) {
    return {
      ok: false,
      error: "Usage: sapporta init <name>\n\n  <name> is the project directory to create.",
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

  progress(`Creating Sapporta project directory at ${projectDir}...`);
  mkdirSync(apiDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(markerPath)) {
    progress("Writing sapporta.json project marker...");
    writeFileSync(markerPath, JSON.stringify({ name: projectName }, null, 2) + "\n");
  }

  try {
    createProject({ dir: projectDir, name: projectName, progress });
    progress("Installing Sapporta assistant skill...");
    const skillMessage = await ensureSapportaSkillInstalled(projectDir);
    return {
      ok: true,
      data: [],
      meta: {
        message: [
          `Initialized project in ${projectDir}. Dependencies installed.`,
          skillMessage,
          `Your Sapporta project is now ready. Run:`,
          `  cd ${projectName}`,
          "  pnpm dev",
        ].join("\n"),
      },
    };
  } catch (err: any) {
    if (err.message.startsWith("package.json already exists")) {
      progress("Project files already exist; checking Sapporta assistant skill...");
      const skillMessage = await ensureSapportaSkillInstalled(projectDir);
      return {
        ok: true,
        data: [],
        meta: {
          message: [
            `${err.message}. Skipping.`,
            skillMessage,
            `Your Sapporta project is now ready. Run:`,
            `  cd ${projectName}`,
            "  pnpm dev",
          ].join("\n"),
        },
      };
    }
    throw err;
  }
}
