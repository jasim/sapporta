import { readFileSync } from "node:fs";
import type { GettingStartedEnv } from "./getting-started-env.js";
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
import type { DevPorts } from "./dev-ports.js";

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
  gettingStartedEnv: GettingStartedEnv;
  devPorts: DevPorts;
}): TemplateVariables {
  const devPorts = opts.devPorts;
  const variables: TemplateVariables = {
    "%%SAPPORTA:SLUG%%": opts.project.slug,
    "%%SAPPORTA:NAME%%": opts.project.name,
    "%%SAPPORTA:AUTH_COOKIE_PREFIX%%": opts.authCookiePrefix,
    "%%SAPPORTA:BETTER_AUTH_DEV_SECRET%%": opts.betterAuthDevSecret,
    // Development ports only. The public app URL that carries the frontend
    // port in .env.development is a local browser origin; a deployment sets it
    // to its own domain, unrelated to either port.
    "%%SAPPORTA:DEV_API_PORT%%": String(devPorts.api),
    "%%SAPPORTA:DEV_FRONTEND_PORT%%": String(devPorts.frontend),
    "%%SAPPORTA:DOCS_BROWSER_URL%%": opts.gettingStartedEnv.docsBrowserUrl,
    "%%SAPPORTA:DOCS_AGENT_URL%%": opts.gettingStartedEnv.docsAgentUrl,
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

export const PNPM_OVERRIDES_DEST = "pnpm-workspace.yaml";

/**
 * Appends the source-link overrides to the generated pnpm-workspace.yaml.
 * pnpm 11 reads workspace settings only from this file; overrides placed in
 * the root package.json's `pnpm` field are ignored, which is how the earlier
 * override mechanism stayed inert without reporting anything.
 */
export function addPnpmOverrides(
  workspaceYaml: string,
  pnpmOverrides: Record<string, string>,
): string {
  if (/^overrides:/m.test(workspaceYaml)) {
    throw new Error(
      `The ${PNPM_OVERRIDES_DEST} template already declares "overrides"; appending source-link overrides would produce a duplicate YAML key.`,
    );
  }
  const lines = Object.entries(pnpmOverrides).map(
    ([packageName, spec]) =>
      `  ${JSON.stringify(packageName)}: ${JSON.stringify(spec)}`,
  );
  return `${workspaceYaml.trimEnd()}\n\noverrides:\n${lines.join("\n")}\n`;
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
  let appliedPnpmOverrides = false;
  const files = opts.templates.map((file) => {
    let content = renderTemplateContent(file.template, opts.variables);
    content = renderSourceLinkResolution(content, opts.sourceLinkMode);
    if (file.dest === PNPM_OVERRIDES_DEST && opts.pnpmOverrides) {
      content = addPnpmOverrides(content, opts.pnpmOverrides);
      appliedPnpmOverrides = true;
    }
    return {
      src: file.src,
      dest: file.dest,
      content,
    };
  });
  // An override set that reaches no file resolves nothing, and a source-linked
  // project would then install a second copy of every shared dependency. Fail
  // here rather than let the mechanism go quiet again if the manifest entry is
  // ever renamed or removed.
  if (opts.pnpmOverrides && !appliedPnpmOverrides) {
    throw new Error(
      `Scaffold overrides were resolved but the manifest has no ${PNPM_OVERRIDES_DEST} entry to write them to.`,
    );
  }
  return files;
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
