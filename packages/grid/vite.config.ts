import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import path from "node:path";
import {
  sapportaLibraryEntries,
  sapportaSourcePackageAliases,
  sapportaSourceResolveConditions,
  sapportaSourceSsrResolveConditions,
} from "../../scripts/sapporta-source-resolution";

export default defineConfig(({ command }) => {
  const useSourcePackages = command === "serve";

  return {
    plugins: [
      react(),
      dts({
        tsconfigPath: "./tsconfig.json",
        entryRoot: "src",
        include: ["src"],
        bundleTypes: false,
        // Keep @sapporta/* imports as public package subpaths in emitted .d.ts.
        aliasesExclude: [/^@sapporta\//],
      }),
    ],
    resolve: {
      conditions: useSourcePackages
        ? sapportaSourceResolveConditions
        : undefined,
      alias: useSourcePackages
        ? sapportaSourcePackageAliases(path.resolve(__dirname, "../.."))
        : undefined,
    },
    ssr: useSourcePackages
      ? {
          resolve: {
            conditions: sapportaSourceSsrResolveConditions,
          },
        }
      : undefined,
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
      cssCodeSplit: false,
      lib: {
        // Build the same JS entrypoints that package.json exports publicly.
        entry: sapportaLibraryEntries(__dirname),
        formats: ["es"],
      },
      rollupOptions: {
        external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (asset) => {
            const name = asset.names?.[0] ?? "";
            if (name.endsWith(".css")) return "index.css";
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
  };
});
