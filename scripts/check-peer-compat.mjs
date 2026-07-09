import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const mode = process.argv[2] ?? "lock";
const dryRun = process.argv.includes("--dry-run");
const root = resolve(new URL("..", import.meta.url).pathname);

const minimumSpecs = {
  "@hono/node-server": "1.14.1",
  "@js-temporal/polyfill": "0.5.1",
  "@sapporta/rest-core": "3.52.2",
  "better-sqlite3": "12.0.0",
  "class-variance-authority": "0.7.1",
  clsx: "2.1.1",
  "drizzle-orm": "0.38.4",
  hono: "4.7.4",
  react: "19.1.0",
  "react-dom": "19.1.0",
  "react-router-dom": "7.13.1",
  zod: "4.3.6",
  zustand: "5.0.5",
};

const rangeCheckedPackages = Object.keys(minimumSpecs);
const verificationCommands = [
  ["pnpm", ["-r", "build"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["check:public-declarations"]],
  ["pnpm", ["check:peer-singletons"]],
  ["pnpm", ["test"]],
];

if (!["lock", "minimum", "latest-in-range"].includes(mode)) {
  console.error(
    "Usage: node scripts/check-peer-compat.mjs [lock|minimum|latest-in-range] [--dry-run]",
  );
  process.exit(1);
}

const workdir = mkdtempSync(join(tmpdir(), `sapporta-peer-${mode}-`));

try {
  copyWorktree(workdir);
  if (mode === "minimum") {
    pinMinimumSpecs(workdir);
  }

  const commands =
    mode === "latest-in-range"
      ? [
          ["pnpm", ["update", "-r", ...rangeCheckedPackages]],
          ...verificationCommands,
        ]
      : [
          [
            "pnpm",
            mode === "lock" ? ["install", "--frozen-lockfile"] : ["install"],
          ],
          ...verificationCommands,
        ];

  if (dryRun) {
    console.log(`temporary project: ${workdir}`);
    for (const [command, args] of commands) {
      console.log([command, ...args].join(" "));
    }
    process.exit(0);
  }

  for (const [command, args] of commands) {
    execFileSync(command, args, { cwd: workdir, stdio: "inherit" });
  }
} finally {
  if (!dryRun && existsSync(workdir)) {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function copyWorktree(destination) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf-8" },
  )
    .split("\0")
    .filter(Boolean);

  for (const file of files) {
    const source = join(root, file);
    if (!existsSync(source)) continue;
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function pinMinimumSpecs(projectRoot) {
  const packageJsonFiles = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "package.json",
      "packages/*/package.json",
    ],
    { cwd: root, encoding: "utf-8" },
  )
    .split("\n")
    .filter(Boolean);

  for (const relativePath of packageJsonFiles) {
    const path = join(projectRoot, relativePath);
    const pkg = JSON.parse(readFileSync(path, "utf-8"));
    let changed = false;
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ]) {
      const dependencies = pkg[section];
      if (!dependencies) {
        continue;
      }
      for (const [name, spec] of Object.entries(minimumSpecs)) {
        if (dependencies[name]) {
          dependencies[name] = spec;
          changed = true;
        }
      }
    }
    if (changed) {
      writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
}
