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
    server: {
      deps: {
        // Better Auth bundles @opentelemetry/semantic-conventions, whose ESM
        // build imports directories rather than files. Node's ESM loader
        // rejects those imports, so this chain is resolved by Vite instead of
        // being externalized.
        inline: [/better-auth/, /@opentelemetry/],
      },
    },
    include: [
      "packages/*/src/**/*.test.ts?(x)",
      "packages/core/template-tests/**/*.test.ts?(x)",
      "tests/**/*.test.ts?(x)",
    ],
  },
});
