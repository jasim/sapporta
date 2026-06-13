#!/usr/bin/env zx

import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const coreDir = dirname(scriptDir);
const repoDir = dirname(dirname(coreDir));

const snapshotPackages = ["cli", "ui", "grid", "frontend", "shared", "honest"];

function pathInCore(...parts) {
  return join(coreDir, ...parts);
}

function pathInRepo(...parts) {
  return join(repoDir, ...parts);
}

async function vendorDependencyPackageSnapshots() {
  for (const packageName of snapshotPackages) {
    const source = pathInRepo("packages", packageName, "package.json");
    const destination = pathInCore(
      "src",
      "templates",
      "dependency-package-snapshots",
      packageName,
      "package.json",
    );

    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

async function cleanBuildOutput() {
  await rm(pathInCore("dist"), { force: true, recursive: true });
  await rm(pathInCore("tsconfig.build.tsbuildinfo"), {
    force: true,
    recursive: true,
  });
}

async function cleanBuildMetadata() {
  await rm(pathInCore("tsconfig.build.tsbuildinfo"), {
    force: true,
    recursive: true,
  });
}

async function copyTemplatesToDist() {
  await rm(pathInCore("dist", "templates"), { force: true, recursive: true });
  await mkdir(pathInCore("dist"), { recursive: true });
  await cp(pathInCore("src", "templates"), pathInCore("dist", "templates"), {
    recursive: true,
  });
}

function run(command, args, label) {
  console.log(`\n> ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: coreDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${label} was interrupted by ${signal}`
            : `${label} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

async function runTypeScriptBuild() {
  await run("tsc", ["-p", "tsconfig.build.json"], "Build TypeScript");
}

async function runTypeScriptWatch() {
  await run(
    "tsc",
    ["-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"],
    "Watch TypeScript build",
  );
}

async function vendor() {
  await vendorDependencyPackageSnapshots();
}

async function build() {
  await vendor();
  await cleanBuildOutput();
  await runTypeScriptBuild();
  await copyTemplatesToDist();
}

async function watch() {
  await vendor();
  await cleanBuildMetadata();
  await mkdir(pathInCore("dist"), { recursive: true });
  await copyTemplatesToDist();
  await runTypeScriptWatch();
}

const commands = { vendor, build, watch };
function scriptArgument(offset) {
  const scriptIndex = process.argv.findIndex((arg) =>
    arg.endsWith("scripts/build.mjs"),
  );

  return process.argv[(scriptIndex >= 0 ? scriptIndex : 1) + offset];
}

const commandName = scriptArgument(1);
const command = commands[commandName];

if (!command) {
  const names = Object.keys(commands).join(", ");
  throw new Error(
    `Unknown build command "${commandName ?? ""}". Expected: ${names}`,
  );
}

await command();
