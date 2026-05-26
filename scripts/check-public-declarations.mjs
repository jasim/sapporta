import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const forbiddenDeclarationImports = {
  "packages/core/dist": ["commander", "winston"],
};

const failures = [];

for (const [dir, packageNames] of Object.entries(forbiddenDeclarationImports)) {
  const absDir = join(root, dir);
  if (!existsSync(absDir)) {
    failures.push(`${dir} does not exist; run package builds first`);
    continue;
  }
  for (const file of declarationFiles(absDir)) {
    const content = readFileSync(file, "utf-8");
    for (const packageName of packageNames) {
      if (
        content.includes(`"${packageName}"`) ||
        content.includes(`'${packageName}'`)
      ) {
        failures.push(`${file} exposes internal package "${packageName}"`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("public declaration imports ok");

function declarationFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return declarationFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".d.ts") ? [path] : [];
  });
}
