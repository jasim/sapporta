#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const root = join(import.meta.dirname, "..");
const projectName = "sapporta-bundle-check";
const budget = {
  initialJsGzip: 120 * 1024,
  initialCssGzip: 20 * 1024,
};

const keepTemp = process.env.SAPPORTA_BUNDLE_KEEP_TEMP === "1";
const existingProject = process.env.SAPPORTA_BUNDLE_PROJECT_DIR;
// By default, measure a fresh scaffold; env override measures an existing app.
const parentDir = existingProject
  ? undefined
  : mkdtempSync(join(tmpdir(), "sapporta-bundle-"));
const projectDir = existingProject ?? join(parentDir, projectName);

try {
  if (!existingProject) {
    run("pnpm", ["--filter", "@sapporta/server", "build"], root);
    run(
      "node",
      [join(root, "packages/core/bin/sapporta.mjs"), "init", projectName],
      parentDir,
      {
        SAPPORTA_DEV_MODE_PACKAGE_ROOT: root,
      },
    );
  }

  run("pnpm", ["build"], projectDir);

  const distDir = join(projectDir, "packages/frontend/dist");
  const indexHtml = readFileSync(join(distDir, "index.html"), "utf-8");
  const assetFiles = await listFiles(join(distDir, "assets"));
  const initialAssetPaths = findInitialAssets(indexHtml).map((assetPath) =>
    join(distDir, assetPath),
  );
  const initialJs = initialAssetPaths.filter((file) => file.endsWith(".js"));
  const initialCss = initialAssetPaths.filter((file) => file.endsWith(".css"));
  const asyncJs = assetFiles
    .filter((file) => file.endsWith(".js") && !initialJs.includes(file))
    .sort((a, b) => gzipSize(b) - gzipSize(a));

  const initialJsGzip = sumGzip(initialJs);
  const initialCssGzip = sumGzip(initialCss);
  const fontFindings = scanForFonts([
    indexHtml,
    ...assetFiles.map((file) => readFileSync(file, "utf-8")),
  ]);

  console.log(`Project: ${projectDir}`);
  console.log(
    `Initial JS gzip: ${formatBytes(initialJsGzip)} (budget ${formatBytes(budget.initialJsGzip)})`,
  );
  console.log(
    `Initial CSS gzip: ${formatBytes(initialCssGzip)} (budget ${formatBytes(budget.initialCssGzip)})`,
  );
  console.log("Async JS chunks:");
  for (const file of asyncJs) {
    console.log(`  ${relative(distDir, file)}: ${formatBytes(gzipSize(file))}`);
  }
  console.log(
    `Custom font requests/rules: ${fontFindings.length === 0 ? "none" : fontFindings.join(", ")}`,
  );

  const failures = [];
  if (initialJsGzip > budget.initialJsGzip) {
    failures.push(
      `initial JS gzip exceeds ${formatBytes(budget.initialJsGzip)}`,
    );
  }
  if (initialCssGzip > budget.initialCssGzip) {
    failures.push(
      `initial CSS gzip exceeds ${formatBytes(budget.initialCssGzip)}`,
    );
  }
  if (fontFindings.length > 0) {
    failures.push("custom font loading was found in built output");
  }
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
} finally {
  if (parentDir && !keepTemp) {
    rmSync(parentDir, { recursive: true, force: true });
  }
}

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function listFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

function findInitialAssets(indexHtml) {
  const assets = new Set();
  const assetPattern = /(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g;
  for (const match of indexHtml.matchAll(assetPattern)) {
    assets.add(match[1]);
  }
  return [...assets];
}

function scanForFonts(contents) {
  const patterns = ["fonts.googleapis.com", "fonts.gstatic.com", "@font-face"];
  return patterns.filter((pattern) =>
    contents.some((content) => content.includes(pattern)),
  );
}

function sumGzip(files) {
  return files.reduce((total, file) => total + gzipSize(file), 0);
}

function gzipSize(file) {
  return gzipSync(readFileSync(file)).length;
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
