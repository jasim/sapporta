#!/usr/bin/env zx

import { spawn } from "node:child_process";

const commands = {
  "prepare-unit": {
    command: "tsc",
    args: ["-p", "packages/core/tsconfig.fixtures.json"],
  },
  unit: {
    command: "vitest",
    args: ["run"],
  },
  watch: {
    command: "vitest",
    args: [],
  },
  "prepare-e2e": {
    command: "pnpm",
    args: ["-r", "--if-present", "build"],
  },
  e2e: {
    command: "vitest",
    args: ["run", "--config", "vitest.e2e.config.ts"],
  },
  "e2e-npm": {
    command: "vitest",
    args: [
      "run",
      "--config",
      "vitest.e2e.config.ts",
      "e2e/init-npm.test.ts",
    ],
    env: { SAPPORTA_E2E_NPM: "1" },
  },
  "e2e-npm-docker": {
    command: "vitest",
    args: [
      "run",
      "--config",
      "vitest.e2e.config.ts",
      "e2e/init-npm-docker.test.ts",
    ],
    env: { SAPPORTA_E2E_NPM_DOCKER: "1" },
  },
  "e2e-docker": {
    command: "vitest",
    args: [
      "run",
      "--config",
      "vitest.e2e.config.ts",
      "e2e/init-docker.test.ts",
    ],
    env: { SAPPORTA_E2E_DOCKER: "1" },
  },
};

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
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

function scriptArgument(offset) {
  const scriptIndex = process.argv.findIndex((arg) =>
    arg.endsWith("scripts/test.mjs"),
  );

  return process.argv[(scriptIndex >= 0 ? scriptIndex : 1) + offset];
}

const commandName = scriptArgument(1);
const selectedCommand = commands[commandName];

if (!selectedCommand) {
  const names = Object.keys(commands).join(", ");
  throw new Error(`Unknown test command "${commandName ?? ""}". Expected: ${names}`);
}

await run(
  selectedCommand.command,
  selectedCommand.args,
  selectedCommand.env,
);
