import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReportDefinition } from "./report.js";

let cacheGeneration = 0;

/**
 * Check if a value looks like a ReportDefinition (duck-typing).
 */
function isReportDefinition(val: unknown): val is ReportDefinition {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.label === "string" &&
    Array.isArray(obj.params) &&
    typeof obj.sources === "object" &&
    obj.sources !== null &&
    typeof obj.tree === "object" &&
    obj.tree !== null
  );
}

/**
 * Load all report definitions from a directory. Each .js file should
 * default-export a report(). See app/loader.ts for why .js-only.
 */
export async function loadReports(
  dir: string,
  bustCache?: boolean,
): Promise<ReportDefinition[]> {
  const absDir = resolve(dir);
  let files: string[];
  try {
    files = await readdir(absDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const reports: ReportDefinition[] = [];

  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    if (file.endsWith(".test.js")) continue;

    const filePath = join(absDir, file);
    const url = bustCache
      ? `${pathToFileURL(filePath).href}?v=${++cacheGeneration}`
      : filePath;
    const mod = await import(url);

    // Check default export first
    if (mod.default && isReportDefinition(mod.default)) {
      reports.push(mod.default);
      continue;
    }

    // Check named exports
    for (const key of Object.keys(mod)) {
      if (isReportDefinition(mod[key])) {
        reports.push(mod[key]);
      }
    }
  }

  return reports;
}
