import { defineConfig } from "vitest/config";
import {
  sapportaSourcePackageAliases,
  sapportaSourceResolveConditions,
  sapportaSourceSsrResolveConditions,
} from "./scripts/sapporta-source-resolution";

export default defineConfig({
  resolve: {
    conditions: sapportaSourceResolveConditions,
    alias: sapportaSourcePackageAliases(__dirname),
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
