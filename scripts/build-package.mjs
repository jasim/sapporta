#!/usr/bin/env zx

import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd();

async function clean(path) {
  await rm(join(cwd, path), { force: true, recursive: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
            ? `${command} was interrupted by ${signal}`
            : `${command} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

await clean("dist");
await clean("tsconfig.build.tsbuildinfo");
await run("tsc", ["-p", "tsconfig.build.json"]);
