#!/usr/bin/env node

// Prints what a release of this repository would contain, as one JSON object
// on stdout. The release train in sapporta-devtools runs `pnpm release:status`
// in every repository it releases and reads this object; it knows nothing else
// about how Sapporta is versioned or published.
//
//   {
//     "packages": [{
//       "name": "@sapporta/ui",
//       "version": "0.4.0",          the version in the checkout
//       "published": true,           whether that version is on npm
//       "dependencies": ["react"],   dependency and peer dependency names
//       "pendingBump": "patch",      what the pending changesets release it as
//       "unnamedChanges": [{ "hash": "031d6ecd", "subject": "..." }]
//     }]
//   }
//
// `unnamedChanges` lists the commits since the last "Version packages" commit
// that touch the package when no pending changeset names it. A package can
// have a pendingBump and unnamedChanges at once: a dependency's changeset
// releases it, but its own changes are not described anywhere yet.

import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { isVersionPublished, workspacePackages } from "./release.mjs";
import {
  lastVersionCommit,
  namedInChangesets,
  releaseOutputExclusions,
  releasePlan,
} from "./version.mjs";

const repoDir = process.cwd();

function git(args) {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function commitsTouching(since, dir) {
  const range = since ? [`${since}..HEAD`] : [];
  return git(["log", "--format=%h%x09%s", ...range, "--", dir, ...releaseOutputExclusions])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split("\t");
      return { hash, subject };
    });
}

async function main() {
  const packages = workspacePackages();
  const plan = releasePlan();
  const bumps = new Map(
    plan.releases
      .filter((release) => release.type !== "none")
      .map((release) => [release.name, release.type]),
  );
  const named = new Set(namedInChangesets(plan).map((release) => release.name));
  const since = lastVersionCommit();

  const status = [];
  for (const { dir, packageJson } of packages) {
    status.push({
      name: packageJson.name,
      version: packageJson.version,
      published: await isVersionPublished(packageJson),
      dependencies: Object.keys({
        ...packageJson.dependencies,
        ...packageJson.peerDependencies,
      }).sort(),
      pendingBump: bumps.get(packageJson.name) ?? null,
      unnamedChanges: named.has(packageJson.name)
        ? []
        : commitsTouching(since, relative(repoDir, dir)),
    });
  }
  process.stdout.write(`${JSON.stringify({ packages: status }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
