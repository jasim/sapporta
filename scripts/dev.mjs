#!/usr/bin/env zx

import { spawn } from "node:child_process";

function run(command, args, label) {
  console.log(`\n> ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

function start(command, args, label) {
  console.log(`\n> ${label}`);

  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });

  return child;
}

await run("pnpm", ["-r", "build"], "Build workspace packages");
await run("pnpm", ["typecheck"], "Typecheck workspace");

const watcher = start(
  "pnpm",
  [
    "-r",
    "--parallel",
    "--stream",
    "--if-present",
    "/^(build:watch|typecheck:watch)$/",
  ],
  "Start workspace watch scripts",
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    watcher.kill(signal);
  });
}

await new Promise((resolve, reject) => {
  watcher.on("exit", (code, signal) => {
    if (code === 0 || signal) {
      resolve();
      return;
    }

    reject(new Error(`Watch scripts exited with code ${code ?? "unknown"}`));
  });
});
