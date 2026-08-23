#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Each child is kept with the label it was started under, so a failure can
// say which one stopped.
const children = new Map();

const frontendPort = readPort("SAPPORTA_FRONTEND_PORT", 5173);
const apiPort = readPort("SAPPORTA_API_PORT", 3000);

// The run ends when the first child stops on its own. This is set up before
// any child starts: a child that exits during startup, as the API does when
// its port is taken, would otherwise be gone from `children` before anything
// was watching, and the run would carry on without it.
let settleRun;
let runSettled = false;
const runStopped = new Promise((settle) => {
  settleRun = settle;
});

function finishRun(reason) {
  if (runSettled) {
    return;
  }

  runSettled = true;
  stopChildren("SIGTERM");
  settleRun(reason);
}

function start(command, args, label) {
  // The frontend starts a second after the API, which is long enough for the
  // API to have already failed and torn the run down. Starting anything after
  // that would leave a child running with nothing watching it.
  if (runSettled) {
    return undefined;
  }

  console.log(`\n> ${label}`);

  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  children.set(child, label);
  child.on("exit", (code, signal) => {
    children.delete(child);

    // A signal means this script asked the child to stop, so the run is
    // already ending; only an exit the child chose reports a reason.
    if (signal) {
      finishRun(undefined);
      return;
    }

    if (code !== 0) {
      finishRun(`${label} exited with code ${code ?? "unknown"}`);
    }
  });

  child.on("error", (error) => {
    console.error(error);
    stopChildren("SIGTERM");
    process.exitCode = 1;
  });

  return child;
}

function stopChildren(signal) {
  for (const child of children.keys()) {
    child.kill(signal);
  }
}

function readPort(name, fallback) {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

function canBind(options) {
  return new Promise((settle) => {
    const server = createServer();
    server.once("error", () => settle(false));
    server.once("listening", () => server.close(() => settle(true)));
    server.listen(options);
  });
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

// Printed first, so both URLs sit at the top of the run instead of arriving
// seconds apart among the compiler and Vite output. This repeats the table
// `@sapporta/core` builds for `sapporta init` rather than importing it, so
// nothing has to resolve before pnpm dev can report itself.
console.log(
  [
    "",
    "Development servers for this project, on ports set in .env.development:",
    "",
    `  App   http://localhost:${frontendPort}   open this in a browser`,
    `  API   http://localhost:${apiPort}   call directly from scripts and coding agents`,
    "",
  ].join("\n"),
);

// Only the frontend port is checked here. The API reports this failure itself:
// boot.ts catches EADDRINUSE and names the setting to change. Vite cannot —
// its strictPort error is thrown inside the vite binary, past any hook this
// project's config could install, and reaches the terminal as a stack trace.
//
// The probe binds the way Vite does, on localhost. A bind clashes only with
// the same address, so probing a different one would report a held port free.
if (!(await canBind({ port: frontendPort, host: "localhost" }))) {
  console.error(
    [
      "",
      "pnpm dev stopped: another process is already using the frontend port.",
      "",
      `  SAPPORTA_FRONTEND_PORT=${frontendPort}`,
      "",
      "Pick a free port and set it wherever this project takes its environment",
      "from, then run pnpm dev again. A new SAPPORTA_FRONTEND_PORT also needs a",
      "matching SAPPORTA_PUBLIC_APP_URL, which is the origin the browser loads",
      "the app from.",
      "",
    ].join("\n"),
  );
  process.exit(1);
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

// Name the child that stopped and let its own output above explain why,
// rather than letting a rejection escape as an unhandled promise and bury
// that output under a stack trace of this script's internals.
const stopped = await runStopped;

if (stopped) {
  console.error(`\npnpm dev stopped: ${stopped}`);
  process.exitCode = 1;
}
