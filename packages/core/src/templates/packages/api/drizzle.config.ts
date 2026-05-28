import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const projectRoot = findProjectRoot(process.cwd());
const databasePath = join(projectRoot, "data", "sqlite.db");
const apiDir = join(projectRoot, "packages", "api");

export default defineConfig({
  dialect: "sqlite",
  schema: join(apiDir, "schema/**/*.ts"),
  out: join(apiDir, "migrations"),
  dbCredentials: {
    url: databasePath,
  },
});

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "sapporta.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find sapporta.json walking up from ${startDir}`);
    }
    dir = parent;
  }
}
