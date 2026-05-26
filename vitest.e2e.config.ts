/**
 * Vitest config for end-to-end tests.
 *
 * These tests scaffold a real project via `sapporta init`, compile it,
 * boot a server, and exercise the full HTTP API. They require:
 *   - packages/core built (dist/ exists with JS + templates)
 *   - pnpm available
 *
 * Run with: pnpm test:e2e
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 420_000,
  },
});
