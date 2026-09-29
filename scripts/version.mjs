#!/usr/bin/env node

// Versions every package that the pending changesets release, plus the
// packages that changesets cannot know about, then refreshes what versioning
// feeds into.
//
// `@sapporta/server` embeds package.json snapshots of the other Sapporta
// packages (packages/core/src/vendored-package-snapshots), and `sapporta init`
// scaffolds projects from those versions. Changesets only follows package.json
// dependencies, so a release of ui, grid, or frontend alone would leave server
// unversioned and new projects would keep the old versions. We add a server
// changeset whenever anything is released; the `workspace:*` pin in `sapporta`
// then releases the CLI package too. After `changeset version`, we write
// server's snapshots and update the lockfile.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { workspacePackages } from "./release.mjs";

const repoDir = process.cwd();
const changesetDir = join(repoDir, ".changeset");
const serverPackage = "@sapporta/server";
const serverChangesetFile = join(changesetDir, "sapporta-server-scaffold-versions.md");

// Changes under these paths are produced by versioning itself and do not need
// a changeset. They are git pathspecs, so they can follow any path list given
// to git diff, git log, or git ls-files.
export const releaseOutputExclusions = [
  ":(exclude,glob)**/CHANGELOG.md",
  ":(exclude)packages/core/src/vendored-package-snapshots",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }
  return result.stdout;
}

function pendingChangesets() {
  return readdirSync(changesetDir).filter(
    (file) => file.endsWith(".md") && file !== "README.md",
  );
}

// The last release is the last commit whose subject starts with "Version
// packages". The subject is matched here rather than with `git log --grep`,
// which would also match a line in a commit body. Returns undefined when no
// release commit exists.
export function lastVersionCommit() {
  return run("git", ["log", "--format=%H%x09%s"], { capture: true })
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, subject]) => subject?.startsWith("Version packages"))?.[0];
}

// Packages whose source changed since the last "Version packages" commit,
// including uncommitted and untracked files.
function changedPackagesSinceLastVersion(packages) {
  const since = lastVersionCommit();
  if (!since) {
    return [];
  }

  const paths = ["--", "packages", ...releaseOutputExclusions];
  const changedFiles = [
    ...run("git", ["diff", "--name-only", since, ...paths], { capture: true }).split("\n"),
    ...run("git", ["ls-files", "--others", "--exclude-standard", ...paths], { capture: true }).split("\n"),
  ].filter(Boolean);

  return packages.filter((pkg) =>
    changedFiles.some((file) => file.startsWith(`${relative(repoDir, pkg.dir)}/`)),
  );
}

async function confirm(question) {
  if (!process.stdin.isTTY) {
    console.log(`${question} Not running in a terminal; continuing.`);
    return true;
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    readline.close();
  }
}

export function namedInChangesets(plan) {
  return plan.changesets.flatMap((changeset) =>
    changeset.releases.filter((release) => release.type !== "none"),
  );
}

// The plan `changeset version` would apply: each pending changeset with the
// packages it names, and every release, including dependents that changesets
// adds because a dependency moved. Without changesets the plan is empty, and
// `changeset status` is not asked: it fails when packages changed since
// `main` and no changeset exists, which is the normal state between releases
// on a branch.
export function releasePlan() {
  if (pendingChangesets().length === 0) {
    return { changesets: [], releases: [] };
  }
  const outputDir = mkdtempSync(join(tmpdir(), "sapporta-release-plan-"));
  try {
    const outputFile = join(outputDir, "plan.json");
    run("pnpm", ["exec", "changeset", "status", `--output=${outputFile}`], { capture: true });
    return JSON.parse(readFileSync(outputFile, "utf8"));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function printUnnamedPackages(heading, packages) {
  console.log(`\n${heading}`);
  for (const pkg of packages) {
    console.log(`  ${pkg.packageJson.name} (${relative(repoDir, pkg.dir)})`);
  }
}

// Writes the snapshots that `sapporta init` reads, then updates the lockfile.
// Both steps are idempotent, so a failed run can simply be repeated.
function refreshScaffoldSnapshots() {
  run("pnpm", ["--filter", serverPackage, "vendor"]);
  run("pnpm", ["install"]);
}

async function main() {
  const packages = workspacePackages();

  if (pendingChangesets().length === 0) {
    const changed = changedPackagesSinceLastVersion(packages);
    if (changed.length > 0) {
      printUnnamedPackages("These packages changed since the last version commit:", changed);
      console.log("To release them, add changesets with `pnpm changeset` and run this again.");
    }
    console.log("\nNo pending changesets; refreshing the scaffold snapshots only.");
    refreshScaffoldSnapshots();
    return;
  }

  const plan = releasePlan();

  const named = new Set(namedInChangesets(plan).map((release) => release.name));
  const unnamed = changedPackagesSinceLastVersion(packages).filter(
    (pkg) => !named.has(pkg.packageJson.name),
  );
  if (unnamed.length > 0) {
    printUnnamedPackages(
      "These packages changed since the last release, but no changeset names them:",
      unnamed,
    );
    console.log(
      "Add a changeset with `pnpm changeset` if the change should be released. A package\n" +
        "released only because a dependency moved gets just an \"Updated dependencies\" entry.",
    );
    if (!(await confirm("Version without changesets for them?"))) {
      process.exitCode = 1;
      return;
    }
  }

  const releases = plan.releases.filter((release) => release.type !== "none");
  if (releases.length > 0 && !releases.some((release) => release.name === serverPackage)) {
    writeFileSync(
      serverChangesetFile,
      `---\n"${serverPackage}": patch\n---\n\nScaffold new projects with the Sapporta package versions from this release.\n`,
    );
    console.log(`\nAdded ${relative(repoDir, serverChangesetFile)} so new projects get this release's versions.`);
  }

  const versionsBefore = new Map(packages.map((pkg) => [pkg.packageJson.name, pkg.packageJson.version]));
  run("pnpm", ["exec", "changeset", "version"]);
  refreshScaffoldSnapshots();

  const versioned = workspacePackages().filter(
    (pkg) => versionsBefore.get(pkg.packageJson.name) !== pkg.packageJson.version,
  );
  if (versioned.length === 0) {
    console.log("\nThe changesets release no packages.");
    return;
  }
  console.log("\nVersioned packages:");
  for (const pkg of versioned) {
    console.log(`  ${pkg.packageJson.name} ${versionsBefore.get(pkg.packageJson.name)} -> ${pkg.packageJson.version}`);
  }
  console.log("\nReview the diff, commit it as \"Version packages for release\", then run `pnpm release:publish`.");
}

// scripts/release-status.mjs imports the helpers above, so versioning runs only
// when this file is the command.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
