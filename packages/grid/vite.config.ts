import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import path from "node:path";
import {
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
        compilerOptions: {
          paths: {
            "@/*": ["./src/*"],
          },
        },
        entryRoot: "src",
        include: ["src"],
        bundleTypes: false,
        aliasesExclude: [/^@sapporta\//],
      }),
    ],
    resolve: {
      conditions: useSourcePackages
        ? sapportaSourceResolveConditions
        : undefined,
      alias: [
        { find: "@", replacement: path.resolve(__dirname, "./src") },
        ...(useSourcePackages
          ? sapportaSourcePackageAliases(path.resolve(__dirname, "../.."))
          : []),
      ],
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
        entry: {
          index: path.resolve(__dirname, "src/index.ts"),
          grid: path.resolve(__dirname, "src/grid/index.ts"),
          "column-preset": path.resolve(
            __dirname,
            "src/column-preset/index.ts",
          ),
          lookup: path.resolve(__dirname, "src/lookup/index.ts"),
          "lookup/react": path.resolve(__dirname, "src/lookup/react/index.ts"),
        },
        formats: ["es"],
      },
      rollupOptions: {
        external: (id) =>
          !id.startsWith(".") && !id.startsWith("@/") && !path.isAbsolute(id),
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
