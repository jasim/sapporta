import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  renderScaffoldFiles,
  scaffoldProjectFromOptions,
  type RenderedScaffoldFile,
} from "./render-scaffold.js";

export type RefreshScaffoldMode = "dry-run" | "write";

export type RefreshScaffoldOptions = {
  projectDir: string;
  mode?: RefreshScaffoldMode;
  devModePackageRoot?: string;
};

export type RefreshScaffoldSummary = {
  projectDir: string;
  mode: RefreshScaffoldMode;
  overwritten: string[];
  created: string[];
  merged: string[];
  skipped: string[];
  unchanged: string[];
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

const REQUIRED_PROJECT_PATHS = [
  "sapporta.json",
  "package.json",
  "packages/api/package.json",
  "packages/frontend/package.json",
  "packages/shared/package.json",
] as const;

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

const PACKAGE_JSON_FILES = new Set([
  "package.json",
  "packages/api/package.json",
  "packages/frontend/package.json",
  "packages/shared/package.json",
]);

export function refreshScaffoldProject(
  opts: RefreshScaffoldOptions,
): RefreshScaffoldSummary {
  const projectDir = resolve(opts.projectDir);
  validateSapportaProject(projectDir);
  const projectName = readProjectName(projectDir);
  const project = scaffoldProjectFromOptions({
    dir: projectDir,
    name: projectName,
  });
  const files = renderScaffoldFiles(
    project,
    opts.devModePackageRoot ?? process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT,
  );
  const mode = opts.mode ?? "write";
  const summary: RefreshScaffoldSummary = {
    projectDir,
    mode,
    overwritten: [],
    created: [],
    merged: [],
    skipped: [],
    unchanged: [],
  };

  for (const file of files) {
    applyRefreshFile(projectDir, file, mode, summary);
  }

  return summary;
}

export function formatRefreshScaffoldSummary(
  summary: RefreshScaffoldSummary,
): string {
  const action = summary.mode === "dry-run" ? "planned" : "applied";
  const lines = [
    `Scaffold refresh ${action} for ${summary.projectDir}`,
    formatSummarySection("overwritten", summary.overwritten),
    formatSummarySection("created", summary.created),
    formatSummarySection("merged", summary.merged),
    formatSummarySection("skipped", summary.skipped),
    formatSummarySection("unchanged", summary.unchanged),
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

function validateSapportaProject(projectDir: string): void {
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    throw new Error(`Target path is not a directory: ${projectDir}`);
  }

  const missing = REQUIRED_PROJECT_PATHS.filter(
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

function applyRefreshFile(
  projectDir: string,
  file: RenderedScaffoldFile,
  mode: RefreshScaffoldMode,
  summary: RefreshScaffoldSummary,
): void {
  if (file.ownership === "workspace" && !PACKAGE_JSON_FILES.has(file.dest)) {
    summary.skipped.push(`${file.dest} (workspace)`);
    return;
  }

  if (file.ownership === "workspace") {
    mergePackageJsonFile(projectDir, file, mode, summary);
    return;
  }

  overwriteFrameworkFile(projectDir, file, mode, summary);
}

function overwriteFrameworkFile(
  projectDir: string,
  file: RenderedScaffoldFile,
  mode: RefreshScaffoldMode,
  summary: RefreshScaffoldSummary,
): void {
  const targetPath = join(projectDir, file.dest);
  const existed = existsSync(targetPath);
  const current = existed ? readFileSync(targetPath, "utf-8") : undefined;
  if (current === file.content) {
    summary.unchanged.push(file.dest);
    return;
  }

  if (mode === "write") {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }

  if (existed) {
    summary.overwritten.push(file.dest);
  } else {
    summary.created.push(file.dest);
  }
}

function mergePackageJsonFile(
  projectDir: string,
  file: RenderedScaffoldFile,
  mode: RefreshScaffoldMode,
  summary: RefreshScaffoldSummary,
): void {
  const targetPath = join(projectDir, file.dest);
  const existing = readJsonObject(targetPath);
  const scaffold = parseJsonObject(file.content, file.dest);
  const merged = mergePackageJson(existing, scaffold);
  const mergedContent = `${JSON.stringify(merged, null, 2)}\n`;
  const current = readFileSync(targetPath, "utf-8");

  if (current === mergedContent) {
    summary.unchanged.push(file.dest);
    return;
  }

  if (mode === "write") {
    writeFileSync(targetPath, mergedContent);
  }
  summary.merged.push(file.dest);
}

export function mergePackageJson(
  existing: JsonObject,
  scaffold: JsonObject,
): JsonObject {
  const merged: JsonObject = { ...existing };

  for (const [key, value] of Object.entries(scaffold)) {
    if (key === "name" || key === "scripts" || isDependencyField(key)) {
      continue;
    }
    if (!(key in merged)) {
      merged[key] = value;
    } else if (key === "pnpm") {
      merged[key] = mergeNestedObject(merged[key], value);
    }
  }

  for (const field of DEPENDENCY_FIELDS) {
    const existingDeps = getStringRecord(existing[field]);
    const scaffoldDeps = getStringRecord(scaffold[field]);
    if (
      Object.keys(scaffoldDeps).length > 0 ||
      Object.keys(existingDeps).length > 0
    ) {
      merged[field] = { ...existingDeps, ...scaffoldDeps };
    }
  }

  return merged;
}

function mergeNestedObject(
  existing: JsonValue,
  scaffold: JsonValue,
): JsonValue {
  if (!isJsonObject(existing) || !isJsonObject(scaffold)) {
    return existing;
  }
  const merged: JsonObject = { ...existing };
  for (const [key, value] of Object.entries(scaffold)) {
    const existingValue = merged[key];
    merged[key] =
      isJsonObject(existingValue) && isJsonObject(value)
        ? mergeNestedObject(existingValue, value)
        : key in merged
          ? existingValue
          : value;
  }
  return merged;
}

function readJsonObject(path: string): JsonObject {
  return parseJsonObject(readFileSync(path, "utf-8"), path);
}

function parseJsonObject(content: string, path: string): JsonObject {
  const parsed: unknown = JSON.parse(content);
  if (!isJsonObject(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed;
}

function isDependencyField(
  key: string,
): key is (typeof DEPENDENCY_FIELDS)[number] {
  return DEPENDENCY_FIELDS.some((field) => field === key);
}

function getStringRecord(value: JsonValue | undefined): Record<string, string> {
  if (!isJsonObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSummarySection(label: string, values: string[]): string {
  if (values.length === 0) {
    return "";
  }
  return `${label}:\n${values.map((value) => `  - ${value}`).join("\n")}`;
}
