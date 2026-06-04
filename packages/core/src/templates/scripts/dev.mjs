#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const children = new Set();

function start(command, args, label) {
  console.log(`\n> ${label}`);

  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  children.add(child);
  child.on("exit", () => {
    children.delete(child);
  });

  child.on("error", (error) => {
    console.error(error);
    stopChildren("SIGTERM");
    process.exitCode = 1;
  });

  return child;
}

function stopChildren(signal) {
  for (const child of children) {
    child.kill(signal);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChildren(signal);
  });
}

await rm("packages/frontend/dist", { force: true, recursive: true });
await mkdir("packages/frontend/dist", { recursive: true });

start(
  "pnpm",
  ["--filter", "./packages/shared", "build:watch"],
  "Watch shared package",
);
start("pnpm", ["--filter", "./packages/api", "dev"], "Start API");

await delay(1000);

start("pnpm", ["--filter", "./packages/frontend", "dev"], "Start frontend");

await new Promise((resolve, reject) => {
  let resolved = false;

  function finish(error) {
    if (resolved) {
      return;
    }

    resolved = true;
    stopChildren("SIGTERM");

    if (error) {
      reject(error);
      return;
    }

    resolve();
  }

  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (signal) {
        finish();
        return;
      }

      if (code !== 0) {
        finish(
          new Error(`A dev process exited with code ${code ?? "unknown"}`),
        );
      }
    });
  }
});
