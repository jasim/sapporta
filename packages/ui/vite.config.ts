import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dts from "vite-plugin-dts";
import path from "node:path";

// Library build. Consumers install @sapporta/ui from npm and get prebuilt
// ESM + .d.ts from dist/ — no source TS, no tsconfig path aliases leaking out.
// The `@/*` alias is resolved at build time (both for JS by Vite/Rollup and
// for .d.ts by vite-plugin-dts).
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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
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
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // Externalize every bare specifier; bundle only relative and alias imports.
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
});
