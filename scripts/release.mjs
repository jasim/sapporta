#!/usr/bin/env node

import { openSync, readdirSync, readFileSync, closeSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

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

function workspacePackages() {
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

  return sortByWorkspaceDependencies(packages);
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

async function isVersionPublished(packageJson) {
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

async function publishPackage({ dir, packageJson }, options) {
  const label = `${packageJson.name}@${packageJson.version}`;
  const published = await isVersionPublished(packageJson);
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
  await run("pnpm", ["build"], "Build workspace");

  const packages = workspacePackages();
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
