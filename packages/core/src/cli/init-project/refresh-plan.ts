import { mergePackageJson, parseJsonObject } from "./package-json-merge.js";
import type { RenderedScaffoldFile } from "./template-rendering.js";

export type RefreshMode = "dry-run" | "write";

export type RefreshFileSnapshot = {
  dest: string;
  exists: boolean;
  content?: string;
};

export type RefreshFileDecision =
  | {
      kind: "skip";
      dest: string;
      reason: "workspace";
    }
  | {
      kind: "unchanged";
      dest: string;
    }
  | {
      kind: "create" | "overwrite" | "merge";
      dest: string;
      content: string;
    };

export type RefreshPlan = {
  projectDir: string;
  mode: RefreshMode;
  decisions: RefreshFileDecision[];
};

export type RefreshSummary = {
  projectDir: string;
  mode: RefreshMode;
  overwritten: string[];
  created: string[];
  merged: string[];
  skipped: string[];
  unchanged: string[];
};

export function planRefreshFile(
  file: RenderedScaffoldFile,
  snapshot: RefreshFileSnapshot,
): RefreshFileDecision {
  switch (file.refreshPolicy) {
    case "skip":
      return { kind: "skip", dest: file.dest, reason: "workspace" };
    case "merge-package-json":
      return planPackageJsonMerge(file, snapshot);
    case "overwrite":
      return planOverwrite(file, snapshot);
  }
}

export function summarizeRefreshPlan(plan: RefreshPlan): RefreshSummary {
  const summary: RefreshSummary = {
    projectDir: plan.projectDir,
    mode: plan.mode,
    overwritten: [],
    created: [],
    merged: [],
    skipped: [],
    unchanged: [],
  };

  for (const decision of plan.decisions) {
    switch (decision.kind) {
      case "overwrite":
        summary.overwritten.push(decision.dest);
        break;
      case "create":
        summary.created.push(decision.dest);
        break;
      case "merge":
        summary.merged.push(decision.dest);
        break;
      case "skip":
        summary.skipped.push(`${decision.dest} (${decision.reason})`);
        break;
      case "unchanged":
        summary.unchanged.push(decision.dest);
        break;
    }
  }

  return summary;
}

export function formatRefreshSummary(summary: RefreshSummary): string {
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

function planOverwrite(
  file: RenderedScaffoldFile,
  snapshot: RefreshFileSnapshot,
): RefreshFileDecision {
  if (snapshot.content === file.content) {
    return { kind: "unchanged", dest: file.dest };
  }
  return {
    kind: snapshot.exists ? "overwrite" : "create",
    dest: file.dest,
    content: file.content,
  };
}

function planPackageJsonMerge(
  file: RenderedScaffoldFile,
  snapshot: RefreshFileSnapshot,
): RefreshFileDecision {
  const existing = parseJsonObject(snapshot.content ?? "{}", file.dest);
  const scaffold = parseJsonObject(file.content, file.dest);
  const merged = mergePackageJson(existing, scaffold);
  const mergedContent = `${JSON.stringify(merged, null, 2)}\n`;
  if (snapshot.content === mergedContent) {
    return { kind: "unchanged", dest: file.dest };
  }
  return { kind: "merge", dest: file.dest, content: mergedContent };
}

function formatSummarySection(label: string, values: string[]): string {
  if (values.length === 0) {
    return "";
  }
  return `${label}:\n${values.map((value) => `  - ${value}`).join("\n")}`;
}
