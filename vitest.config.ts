import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors packages/ui/vite.config.ts so tests resolve `@/foo` the same
      // way the production build does.
      "@": path.resolve(__dirname, "./packages/ui/src"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/src/**/*.test.ts"],
  },
});
