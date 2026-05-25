import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors packages/frontend/vite.config.ts for moved admin/table/report
      // tests. Lower-level packages should use relative imports or package
      // entrypoints instead of the frontend-local alias.
      "@": path.resolve(__dirname, "./packages/frontend/src"),
      "@sapporta/grid/column-preset": path.resolve(
        __dirname,
        "./packages/grid/src/column-preset/index.ts",
      ),
      "@sapporta/grid/lookup": path.resolve(
        __dirname,
        "./packages/grid/src/lookup/index.ts",
      ),
      "@sapporta/grid": path.resolve(__dirname, "./packages/grid/src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/src/**/*.test.ts"],
  },
});
