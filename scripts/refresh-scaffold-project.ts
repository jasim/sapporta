#!/usr/bin/env -S pnpm exec tsx

import { resolve } from "node:path";
import {
  formatRefreshScaffoldSummary,
  refreshScaffoldProject,
  type RefreshScaffoldMode,
} from "../packages/core/src/cli/init-project/refresh-project.js";

const args = process.argv.slice(2);
const mode = parseMode(args);
const positional = args.filter((arg) => !arg.startsWith("--"));
const target = positional[0];

if (!target) {
  console.error(
    "Usage: pnpm scaffold:refresh <project-path> [--dry-run | --write]",
  );
  process.exit(1);
}

try {
  const summary = refreshScaffoldProject({
    projectDir: resolve(target),
    mode,
    devModePackageRoot: process.cwd(),
  });
  console.log(formatRefreshScaffoldSummary(summary));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`scaffold:refresh failed: ${message}`);
  process.exit(1);
}

function parseMode(args: string[]): RefreshScaffoldMode {
  const hasDryRun = args.includes("--dry-run");
  const hasWrite = args.includes("--write");
  if (hasDryRun && hasWrite) {
    console.error("Use only one of --dry-run or --write.");
    process.exit(1);
  }
  return hasDryRun ? "dry-run" : "write";
}
