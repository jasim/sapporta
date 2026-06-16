import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseJsonObject } from "./package-json-merge.js";
import {
  layoutForRoot,
  projectIdentityFromOptions,
  requiredProjectPaths,
} from "./project-layout.js";
import { renderScaffoldFiles } from "./render-scaffold.js";
import type { RenderedScaffoldFile } from "./template-rendering.js";
import {
  formatRefreshSummary,
  planRefreshFile,
  summarizeRefreshPlan,
  type RefreshMode,
  type RefreshPlan,
  type RefreshSummary,
} from "./refresh-plan.js";

export type RefreshScaffoldOptions = {
  projectDir: string;
  mode?: RefreshMode;
  devModePackageRoot?: string;
};

export function refreshScaffoldProject(
  opts: RefreshScaffoldOptions,
): RefreshSummary {
  const projectDir = resolve(opts.projectDir);
  validateSapportaProject(projectDir);
  const projectName = readProjectName(projectDir);
  const project = layoutForRoot(
    projectIdentityFromOptions({
      dir: projectDir,
      name: projectName,
    }),
  );
  const files = renderScaffoldFiles(
    project,
    opts.devModePackageRoot ?? process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT,
  );
  const mode = opts.mode ?? "write";
  const plan = buildRefreshPlan(projectDir, mode, files);

  if (mode === "write") {
    executeRefreshPlan(projectDir, plan);
  }

  return summarizeRefreshPlan(plan);
}

export function formatRefreshScaffoldSummary(summary: RefreshSummary): string {
  return formatRefreshSummary(summary);
}

function validateSapportaProject(projectDir: string): void {
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    throw new Error(`Target path is not a directory: ${projectDir}`);
  }

  const missing = requiredProjectPaths().filter(
    (path) => !existsSync(join(projectDir, path)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Target does not look like a Sapporta project. Missing: ${missing.join(", ")}`,
    );
  }
}

function readProjectName(projectDir: string): string {
  const packageJsonPath = join(projectDir, "package.json");
  const pkg = readJsonObject(packageJsonPath);
  return typeof pkg.name === "string" && pkg.name.length > 0
    ? pkg.name
    : basename(projectDir);
}

function buildRefreshPlan(
  projectDir: string,
  mode: RefreshMode,
  files: readonly RenderedScaffoldFile[],
): RefreshPlan {
  return {
    projectDir,
    mode,
    decisions: files.map((file) =>
      planRefreshFile(file, {
        dest: file.dest,
        exists: existsSync(join(projectDir, file.dest)),
        content: readExistingFile(projectDir, file),
      }),
    ),
  };
}

function executeRefreshPlan(projectDir: string, plan: RefreshPlan): void {
  for (const decision of plan.decisions) {
    if (
      decision.kind === "create" ||
      decision.kind === "overwrite" ||
      decision.kind === "merge"
    ) {
      const targetPath = join(projectDir, decision.dest);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, decision.content);
    }
  }
}

function readExistingFile(
  projectDir: string,
  file: RenderedScaffoldFile,
): string | undefined {
  const path = join(projectDir, file.dest);
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, "utf-8");
}

function readJsonObject(path: string) {
  return parseJsonObject(readFileSync(path, "utf-8"), path);
}
