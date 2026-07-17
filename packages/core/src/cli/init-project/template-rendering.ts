import { readFileSync } from "node:fs";
import type { ProjectLayout } from "./project-layout.js";
import {
  DEPENDENCY_CATALOG,
  sharedRuntimeDefinitions,
  type ScaffoldPackages,
} from "./dependency-catalog.js";
import type {
  ScaffoldManifest,
  ScaffoldFileSpec,
} from "./scaffold-manifest.js";
import { SCAFFOLD_MANIFEST } from "./scaffold-manifest.js";
import { initProjectPackagePaths } from "./paths.js";

export type TemplateVariables = Record<string, string>;

export type RenderedScaffoldFile = ScaffoldFileSpec & {
  content: string;
};

export type UnresolvedTemplateToken = {
  dest: string;
  token: string;
};

const VITE_SOURCE_LINK_RESOLUTION_MARKER =
  "    // %%SAPPORTA:VITE_SOURCE_LINK_RESOLUTION%%";

export function buildTemplateVariables(opts: {
  project: ProjectLayout;
  packages: ScaffoldPackages;
  authCookiePrefix: string;
  betterAuthDevSecret: string;
}): TemplateVariables {
  const variables: TemplateVariables = {
    "%%SAPPORTA:SLUG%%": opts.project.slug,
    "%%SAPPORTA:NAME%%": opts.project.name,
    "%%SAPPORTA:AUTH_COOKIE_PREFIX%%": opts.authCookiePrefix,
    "%%SAPPORTA:BETTER_AUTH_DEV_SECRET%%": opts.betterAuthDevSecret,
    // The template treats the executable and preload as one token so every
    // source-linked API uses the same scoped resolver. Registry output receives
    // the ordinary `node` command and never loads framework-development code.
    "%%SAPPORTA:NODE_COMMAND%%": opts.packages.sourceLinkMode
      ? "node --import @sapporta/server/source-link-runtime"
      : "node",
  };
  for (const [key, token] of DEPENDENCY_CATALOG.tokenByKey) {
    variables[token] = opts.packages.specs[key];
  }
  return variables;
}

export function renderTemplateContent(
  content: string,
  variables: TemplateVariables,
): string {
  let rendered = content;
  for (const [token, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(token, value);
  }
  return rendered;
}

export function addPnpmOverrides(
  rootPackageJson: string,
  pnpmOverrides: Record<string, string>,
): string {
  const pkg = JSON.parse(rootPackageJson) as {
    pnpm?: { overrides?: Record<string, string> };
  };
  pkg.pnpm = pkg.pnpm ?? {};
  pkg.pnpm.overrides = { ...(pkg.pnpm.overrides ?? {}), ...pnpmOverrides };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function findUnresolvedTokens(
  files: readonly RenderedScaffoldFile[],
): UnresolvedTemplateToken[] {
  const unresolvedToken = /%%SAPPORTA:[A-Z0-9_]+%%/g;
  return files.flatMap((file) =>
    [...file.content.matchAll(unresolvedToken)].map((match) => ({
      dest: file.dest,
      token: match[0],
    })),
  );
}

export function readTemplateFile(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  filename: string,
): string {
  return readFileSync(initPaths.templatePath(filename), "utf-8");
}

export function readScaffoldTemplates(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  manifest: ScaffoldManifest = SCAFFOLD_MANIFEST,
): Array<ScaffoldFileSpec & { template: string }> {
  return manifest.map((file) => ({
    ...file,
    template: readTemplateFile(initPaths, file.src),
  }));
}

export function renderScaffoldTemplates(opts: {
  templates: ReadonlyArray<ScaffoldFileSpec & { template: string }>;
  variables: TemplateVariables;
  sourceLinkMode: boolean;
  pnpmOverrides?: Record<string, string>;
}): RenderedScaffoldFile[] {
  return opts.templates.map((file) => {
    let content = renderTemplateContent(file.template, opts.variables);
    content = renderSourceLinkResolution(content, opts.sourceLinkMode);
    if (file.dest === "package.json" && opts.pnpmOverrides) {
      content = addPnpmOverrides(content, opts.pnpmOverrides);
    }
    return {
      src: file.src,
      dest: file.dest,
      ownership: file.ownership,
      refreshPolicy: file.refreshPolicy,
      content,
    };
  });
}

/**
 * Source-link mode originally used Vite's global `preserveSymlinks` setting.
 * That also preserved pnpm's internal links, so transitive imports such as
 * `react-router-dom -> react-router/dom` could no longer resolve from pnpm's
 * package-store layout. Vite dedupe is the narrower browser mechanism: only
 * catalog-declared shared runtimes resolve from the generated frontend, while
 * every other dependency keeps normal realpath behavior.
 *
 * The raw TypeScript template uses a comment as a syntactically valid marker.
 * Replacing the entire line keeps this maintainer-only rationale and the marker
 * itself out of every generated project.
 */
function renderSourceLinkResolution(
  content: string,
  sourceLinkMode: boolean,
): string {
  return content.replace(
    VITE_SOURCE_LINK_RESOLUTION_MARKER,
    sourceLinkMode ? renderViteDedupe() : "",
  );
}

function renderViteDedupe(): string {
  return [
    "    dedupe: [",
    ...sharedRuntimeDefinitions("browser").map(
      (definition) => `      ${JSON.stringify(definition.packageName)},`,
    ),
    "    ],",
  ].join("\n");
}
