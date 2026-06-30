import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dts from "vite-plugin-dts";
import path from "node:path";
import { sapportaLibraryEntries } from "../../scripts/sapporta-source-resolution";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({
      tsconfigPath: "./tsconfig.json",
      entryRoot: "src",
      include: ["src"],
      bundleTypes: false,
      // Keep @sapporta/* imports as public package subpaths in emitted .d.ts.
      aliasesExclude: [/^@sapporta\//],
    }),
  ],
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
});
