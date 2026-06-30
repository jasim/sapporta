import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dts from "vite-plugin-dts";
import path from "node:path";
import { sapportaLibraryEntries } from "../../scripts/sapporta-source-resolution";

// Library build. Consumers install @sapporta/ui from npm and get prebuilt
// ESM + .d.ts from dist/ — no source TS, no tsconfig path aliases leaking out.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({
      tsconfigPath: "./tsconfig.json",
      entryRoot: "src",
      include: ["src"],
      bundleTypes: false,
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
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
      // Externalize every bare specifier; bundle only relative imports.
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
