#!/usr/bin/env node

// Versions every package that the pending changesets release, plus the
// packages that changesets cannot know about. It does what `changeset version`
// does (read the release plan, then apply it), with two changes to the plan:
//
// 1. `@sapporta/server` embeds package.json snapshots of the other Sapporta
//    packages (packages/core/src/vendored-package-snapshots), and
//    `sapporta init` scaffolds projects from those versions. Changesets only
//    follows package.json dependencies, so a release of ui, grid, or frontend
//    alone would leave server unversioned and new projects would keep the old
//    versions. We add a server changeset whenever anything is released; the
//    `workspace:*` pin in `sapporta` then releases the CLI package too.
//
// 2. Changesets gives a package a major bump when one of its peer
//    dependencies gets a minor or major release. `@sapporta/server` has
//    `@sapporta/honest` as a peer, so a honest minor release would take server
//    from 0.8.x to 1.0.0. While a package is on 0.x, a minor bump is the
//    breaking bump, so we lower such cascaded majors to minors. A changeset
//    that names a 0.x package as major still takes it to 1.0.0.

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import applyReleasePlan from "@changesets/apply-release-plan";
import { read as readConfig } from "@changesets/config";
import getReleasePlan from "@changesets/get-release-plan";
import { getPackages } from "@manypkg/get-packages";

const repoDir = process.cwd();
const changesetDir = join(repoDir, ".changeset");
const serverPackage = "@sapporta/server";
const serverChangesetFile = join(changesetDir, "sapporta-server-scaffold-versions.md");

// Changes under these paths are produced by versioning itself and do not need
// a changeset.
const releaseOutputPaths = [
  /\/CHANGELOG\.md$/,
  /^packages\/core\/src\/vendored-package-snapshots\//,
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

// Packages whose source changed since the last "Version packages" commit,
// including uncommitted and untracked files.
function changedPackagesSinceLastVersion(packages) {
  const lastVersionCommit = run(
    "git",
    ["log", "-1", "--format=%H", "--diff-filter=D", "--grep=^Version packages", "--", ".changeset"],
    { capture: true },
  ).trim();
  if (!lastVersionCommit) {
    return [];
  }

  const changedFiles = [
    ...run("git", ["diff", "--name-only", lastVersionCommit, "--", "packages"], { capture: true }).split("\n"),
    ...run("git", ["ls-files", "--others", "--exclude-standard", "--", "packages"], { capture: true }).split("\n"),
  ]
    .filter(Boolean)
    .filter((file) => !releaseOutputPaths.some((pattern) => pattern.test(file)));

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

function namedInChangesets(plan) {
  return plan.changesets.flatMap((changeset) =>
    changeset.releases.filter((release) => release.type !== "none"),
  );
}

function keepZeroMajorOnZero(plan) {
  const namedMajor = new Set(
    namedInChangesets(plan)
      .filter((release) => release.type === "major")
      .map((release) => release.name),
  );
  for (const release of plan.releases) {
    // Prerelease versions such as 0.8.0-beta.1 keep changesets' bump.
    const zeroMinor = release.oldVersion.match(/^0\.(\d+)\.\d+$/)?.[1];
    if (release.type === "major" && zeroMinor !== undefined && !namedMajor.has(release.name)) {
      release.type = "minor";
      release.newVersion = `0.${Number(zeroMinor) + 1}.0`;
    }
  }
  return plan;
}

// This script covers the parts of `changeset version` this repository uses.
// Pre mode, `commit`, and `ignore` would need behaviour it does not have.
function assertSupportedSetup(config) {
  if (existsSync(join(changesetDir, "pre.json"))) {
    throw new Error(
      "Changesets pre mode is on (.changeset/pre.json). scripts/version.mjs does not support " +
        "prereleases; run `pnpm exec changeset pre exit` first.",
    );
  }
  if (config.commit) {
    throw new Error("scripts/version.mjs does not support `commit` in .changeset/config.json.");
  }
  if (config.ignore.length > 0) {
    throw new Error("scripts/version.mjs does not support `ignore` in .changeset/config.json.");
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
  const workspace = await getPackages(repoDir);
  const config = await readConfig(repoDir, workspace);
  assertSupportedSetup(config);
  const packages = workspace.packages.filter((pkg) => !pkg.packageJson.private);

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

  let plan = await getReleasePlan(repoDir);

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
    plan = await getReleasePlan(repoDir);
  }

  plan = keepZeroMajorOnZero(plan);
  await applyReleasePlan(plan, workspace, config, undefined, repoDir);
  refreshScaffoldSnapshots();

  const versioned = plan.releases.filter((release) => release.type !== "none");
  if (versioned.length === 0) {
    console.log("\nThe changesets release no packages.");
    return;
  }
  console.log("\nVersioned packages:");
  for (const release of versioned) {
    console.log(`  ${release.name} ${release.oldVersion} -> ${release.newVersion} (${release.type})`);
  }
  console.log("\nReview the diff, commit it as \"Version packages for release\", then run `pnpm release`.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
