import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dts from "vite-plugin-dts";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
        app: path.resolve(__dirname, "src/app/index.ts"),
        platform: path.resolve(__dirname, "src/platform/index.ts"),
        schema: path.resolve(__dirname, "src/schema-catalog/index.ts"),
        auth: path.resolve(__dirname, "src/auth/index.ts"),
        "auth/runtime": path.resolve(__dirname, "src/auth/runtime.ts"),
        "auth/pages": path.resolve(__dirname, "src/auth/pages.ts"),
        layout: path.resolve(
          __dirname,
          "src/shell/components/SidebarShell.tsx",
        ),
        shell: path.resolve(__dirname, "src/shell.ts"),
        "routes/table": path.resolve(__dirname, "src/routes/table.ts"),
        "routes/new-record": path.resolve(
          __dirname,
          "src/routes/new-record.ts",
        ),
        report: path.resolve(__dirname, "src/report/index.ts"),
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
});
