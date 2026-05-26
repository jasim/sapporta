import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(process.argv[2] ?? ".");
const identityPackages = [
  "hono",
  "drizzle-orm",
  "better-sqlite3",
  "zod",
  "@sapporta/rest-core",
  "@js-temporal/polyfill",
  "react",
  "react-dom",
  "react-router-dom",
  "zustand",
];

if (!existsSync(resolve(projectRoot, "package.json"))) {
  console.error(`${projectRoot} does not contain package.json`);
  process.exit(1);
}

const failures = [];

for (const packageName of identityPackages) {
  const roots = JSON.parse(
    execFileSync("pnpm", ["list", packageName, "--depth", "Infinity", "--json"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const instances = collectPackageInstances(roots, packageName);
  if (instances.size === 0) {
    failures.push(`${packageName}: not installed`);
    continue;
  }
  if (instances.size > 1) {
    failures.push(
      `${packageName}: expected one physical package, found ${instances.size}\n` +
        [...instances].map((path) => `  ${path}`).join("\n"),
    );
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("peer singleton graph ok");

function collectPackageInstances(roots, packageName) {
  const instances = new Set();
  for (const root of roots) {
    visitDependencies(root.dependencies, packageName, instances);
    visitDependencies(root.devDependencies, packageName, instances);
    visitDependencies(root.optionalDependencies, packageName, instances);
  }
  return instances;
}

function visitDependencies(dependencies, packageName, instances) {
  if (!dependencies) {
    return;
  }
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (name === packageName && dependency.path) {
      instances.add(dependency.path);
    }
    visitDependencies(dependency.dependencies, packageName, instances);
    visitDependencies(dependency.devDependencies, packageName, instances);
    visitDependencies(dependency.optionalDependencies, packageName, instances);
  }
}
