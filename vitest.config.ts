import { defineConfig } from "vitest/config";
import path from "node:path";
import {
  sapportaSourcePackageAliases,
  sapportaSourceResolveConditions,
  sapportaSourceSsrResolveConditions,
} from "./scripts/sapporta-source-resolution";

export default defineConfig({
  resolve: {
    conditions: sapportaSourceResolveConditions,
    alias: [
      // Mirrors packages/frontend/vite.config.ts for moved admin/table/report
      // tests. Lower-level packages should use relative imports or package
      // entrypoints instead of the frontend-local alias.
      {
        find: "@",
        replacement: path.resolve(__dirname, "./packages/frontend/src"),
      },
      ...sapportaSourcePackageAliases(__dirname),
    ],
  },
  ssr: {
    resolve: {
      conditions: sapportaSourceSsrResolveConditions,
    },
  },
  test: {
    globals: true,
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/core/template-tests/**/*.test.ts",
    ],
  },
});
