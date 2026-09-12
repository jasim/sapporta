import { defineConfig } from "drizzle-kit";
import { databasePath } from "@sapporta/server/data-dir";

/**
 * Drizzle reads the application and auth schemas to generate migrations.
 * Sapporta loads the application schema at runtime to create its table APIs and
 * screens.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./schema/**/*.ts",
    "./project-auth/schema.ts",
    "./project-auth/auth-tokens-schema.ts",
  ],
  out: "./migrations",
  dbCredentials: {
    // The same database the app opens: sqlite.db in SAPPORTA_DATA_DIR.
    url: databasePath(),
  },
});
