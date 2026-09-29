#!/usr/bin/env node

import { openSync, readdirSync, readFileSync, closeSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const repoDir = process.cwd();
const packageRoot = join(repoDir, "packages");

function parseArgs(argv) {
  const options = {
    dryRun: false,
    tag: "latest",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--tag") {
      const tag = argv[index + 1];
      if (!tag) {
        throw new Error("--tag requires a value");
      }
      options.tag = tag;
      index += 1;
      continue;
    }

    if (arg.startsWith("--tag=")) {
      options.tag = arg.slice("--tag=".length);
      continue;
    }

    throw new Error(`Unknown release option: ${arg}`);
  }

  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function workspacePackages() {
  const packages = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(packageRoot, entry.name);
      return {
        dir,
        packageJson: readJson(join(dir, "package.json")),
      };
    })
    .filter(({ packageJson }) => !packageJson.private);

  return scaffoldPackagesLast(sortByWorkspaceDependencies(packages));
}

// `@sapporta/server` embeds the other packages' versions for `sapporta init`,
// and `sapporta` pins `@sapporta/server`. Both ship with every release and go
// out last, so a published server never scaffolds versions that are not on npm
// yet, and a release that failed partway can be resumed.
const scaffoldPackageNames = ["@sapporta/server", "sapporta"];

function scaffoldPackagesLast(packages) {
  const isScaffold = (pkg) => scaffoldPackageNames.includes(pkg.packageJson.name);
  return [
    ...packages.filter((pkg) => !isScaffold(pkg)),
    ...scaffoldPackageNames.map((name) => {
      const pkg = packages.find((candidate) => candidate.packageJson.name === name);
      if (!pkg) {
        throw new Error(`${name} is not a public workspace package; release.mjs publishes it last.`);
      }
      return pkg;
    }),
  ];
}

function sortByWorkspaceDependencies(packages) {
  const packageByName = new Map(
    packages.map((pkg) => [pkg.packageJson.name, pkg]),
  );
  const visiting = new Set();
  const visited = new Set();
  const sorted = [];

  function visit(pkg) {
    const name = pkg.packageJson.name;
    if (visited.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`Workspace dependency cycle includes ${name}`);
    }

    visiting.add(name);
    const dependencyNames = Object.keys(pkg.packageJson.dependencies ?? {});
    for (const dependencyName of dependencyNames) {
      const dependency = packageByName.get(dependencyName);
      if (dependency) {
        visit(dependency);
      }
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(pkg);
  }

  for (const pkg of packages) {
    visit(pkg);
  }

  return sorted;
}

function registryFor(packageJson) {
  return (
    packageJson.publishConfig?.registry ?? "https://registry.npmjs.org/"
  );
}

function accessFor(packageJson) {
  return packageJson.publishConfig?.access ?? "public";
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function run(command, args, label, options = {}) {
  console.log(`\n> ${label}`);
  const result = await spawnCommand(command, args, {
    cwd: options.cwd ?? repoDir,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });

  if (result.code === 0) {
    return result;
  }

  throw new Error(
    result.signal
      ? `${label} was interrupted by ${result.signal}`
      : `${label} exited with code ${result.code ?? "unknown"}`,
  );
}

function npmInfoArgs(packageJson) {
  return [
    "info",
    `${packageJson.name}@${packageJson.version}`,
    "--json",
    `--registry=${registryFor(packageJson)}`,
  ];
}

export async function isVersionPublished(packageJson) {
  const result = await spawnCommand("npm", npmInfoArgs(packageJson), {
    cwd: repoDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.code === 0 && result.stdout.trim()) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes("E404") || output.includes("404 Not Found")) {
    return false;
  }

  throw new Error(
    `Could not check ${packageJson.name}@${packageJson.version} on npm:\n${output.trim()}`,
  );
}

function releaseStdin() {
  if (process.stdin.isTTY) {
    return { fd: "inherit", close: () => {} };
  }

  try {
    const fd = openSync("/dev/tty", "r");
    return { fd, close: () => closeSync(fd) };
  } catch {
    return { fd: "inherit", close: () => {} };
  }
}

function pendingChangesets() {
  return readdirSync(join(repoDir, ".changeset")).filter(
    (file) => file.endsWith(".md") && file !== "README.md",
  );
}

// Publishing is in order, with the scaffold packages last, so every package
// before a published scaffold package must be published too. Otherwise the
// release was versioned without `pnpm release:version`, which releases them with
// every other package.
function assertScaffoldPackagesReleased(packages) {
  packages.forEach((pkg, index) => {
    if (!scaffoldPackageNames.includes(pkg.packageJson.name) || !pkg.published) {
      return;
    }
    const unpublished = packages.slice(0, index).filter((earlier) => !earlier.published);
    if (unpublished.length > 0) {
      throw new Error(
        `This release publishes ${unpublished.map((earlier) => earlier.packageJson.name).join(", ")} ` +
          `but not ${pkg.packageJson.name}, whose current version is already on npm. ` +
          "Add a patch changeset for @sapporta/server, run `pnpm release:version`, and release again.",
      );
    }
  });
}

async function publishPackage({ dir, packageJson, published }, options) {
  const label = `${packageJson.name}@${packageJson.version}`;
  if (published) {
    console.log(`Skipping ${label}; this version is already published.`);
    return "skipped";
  }

  console.log(`Publishing ${label}.`);
  const args = [
    "publish",
    "--access",
    accessFor(packageJson),
    "--tag",
    options.tag,
    "--no-git-checks",
  ];

  if (options.dryRun) {
    args.push("--dry-run");
  }

  const tty = releaseStdin();
  try {
    await run("pnpm", args, `Publish ${label}`, {
      cwd: dir,
      env: {
        ...process.env,
        npm_config_registry: registryFor(packageJson),
      },
      stdio: [tty.fd, "inherit", "inherit"],
    });
  } finally {
    tty.close();
  }

  return options.dryRun ? "dry-run" : "published";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const pending = pendingChangesets();
  if (pending.length > 0) {
    throw new Error(
      `Pending changesets in .changeset/ (${pending.join(", ")}). Run \`pnpm release:version\` first.`,
    );
  }

  const packages = [];
  for (const pkg of workspacePackages()) {
    packages.push({ ...pkg, published: await isVersionPublished(pkg.packageJson) });
  }
  assertScaffoldPackagesReleased(packages);

  await run("pnpm", ["build"], "Build workspace");

  const published = [];
  const skipped = [];
  for (const pkg of packages) {
    const result = await publishPackage(pkg, options);
    if (result === "skipped") {
      skipped.push(pkg.packageJson.name);
    } else {
      published.push(pkg.packageJson.name);
    }
  }

  console.log("\nRelease summary");
  console.log(`Published: ${published.length ? published.join(", ") : "none"}`);
  console.log(`Skipped: ${skipped.length ? skipped.join(", ") : "none"}`);
}

// scripts/release-status.mjs imports the npm check above, so publishing runs
// only when this file is the command.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
