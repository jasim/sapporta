import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const architecture = readFileSync(join(root, "ARCHITECTURE.md"), "utf-8");
const agents = readFileSync(join(root, "AGENTS.md"), "utf-8");

const failures = [];

for (const dir of workspacePackageDirs()) {
  const packageJson = JSON.parse(
    readFileSync(join(root, "packages", dir, "package.json"), "utf-8"),
  );

  for (const [doc, content] of [
    ["AGENTS.md", agents],
    ["ARCHITECTURE.md", architecture],
  ]) {
    if (!content.includes(`packages/${dir}/`)) {
      failures.push(`${doc} does not mention packages/${dir}/`);
    }
  }

  if (!packageJson.exports) continue;

  // Node refuses any subpath an exports map does not list, so omitting
  // "./package.json" breaks require.resolve("<pkg>/package.json") — the one
  // manager-agnostic way to locate an installed package without guessing at
  // node_modules layout. Every package must keep it exported.
  if (packageJson.exports["./package.json"] !== "./package.json") {
    failures.push(
      `${packageJson.name}: exports must map "./package.json" to "./package.json" so the package stays resolvable`,
    );
  }

  const actual = Object.keys(packageJson.exports).filter(
    (subpath) => subpath !== "./package.json",
  );
  const documented = documentedModules(packageJson.name, dir);
  if (documented === undefined) {
    failures.push(
      `ARCHITECTURE.md has no "### ${packageJson.name} — packages/${dir}" section`,
    );
    continue;
  }

  for (const subpath of actual) {
    if (!documented.includes(subpath)) {
      failures.push(
        `${packageJson.name}: export "${subpath}" is missing from its ARCHITECTURE.md module table`,
      );
    }
  }
  for (const subpath of documented) {
    if (!actual.includes(subpath)) {
      failures.push(
        `${packageJson.name}: ARCHITECTURE.md documents "${subpath}" but package.json does not export it`,
      );
    }
  }

  // A package README may repeat the module map for readers who arrive from
  // npm rather than the repository. That copy is not the source of truth, so
  // it is held to the same subpath set rather than being allowed to drift.
  const readme = readmeModules(dir);
  if (readme === undefined) continue;

  for (const subpath of actual) {
    if (!readme.includes(subpath)) {
      failures.push(
        `${packageJson.name}: export "${subpath}" is missing from the "## Modules" section of packages/${dir}/README.md`,
      );
    }
  }
  for (const subpath of readme) {
    if (!actual.includes(subpath)) {
      failures.push(
        `${packageJson.name}: packages/${dir}/README.md documents "${subpath}" but package.json does not export it`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("module index ok");

function workspacePackageDirs() {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(root, "packages", entry.name, "package.json")),
    )
    .map((entry) => entry.name);
}

// Collect the first backticked token of every table row in the package's
// "### <npm-name> — packages/<dir>" section of ARCHITECTURE.md.
function documentedModules(npmName, dir) {
  const heading = `### ${npmName} — packages/${dir}`;
  const start = architecture.indexOf(heading);
  if (start === -1) return undefined;

  const rest = architecture.slice(start + heading.length);
  const nextHeading = rest.search(/\n#{2,3} /);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const modules = [];
  for (const line of section.split("\n")) {
    const row = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (row && row[1] !== "Module") modules.push(row[1]);
  }
  return modules;
}

// Collect every backticked subpath in the "## Modules" section of a package
// README, wherever it sits in the row — a row may name several related
// subpaths in its prose instead of giving each one its own line. Returns
// undefined when the README has no such section.
function readmeModules(dir) {
  const path = join(root, "packages", dir, "README.md");
  if (!existsSync(path)) return undefined;

  const readme = readFileSync(path, "utf-8");
  const start = readme.indexOf("## Modules");
  if (start === -1) return undefined;

  const rest = readme.slice(start + "## Modules".length);
  const nextHeading = rest.search(/\n#{2,3} /);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const modules = new Set();
  for (const [, token] of section.matchAll(/`([^`]+)`/g)) {
    if (token === "." || token.startsWith("./")) modules.add(token);
  }
  return [...modules];
}
