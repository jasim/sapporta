import { randomBytes } from "node:crypto";
import { randomDevPorts, type DevPorts } from "./dev-ports.js";
import { resolveScaffoldPackages } from "./dependency-catalog.js";
import {
  resolveGettingStartedEnv,
  type GettingStartedEnv,
} from "./getting-started-env.js";
import type { ProjectLayout } from "./project-layout.js";
import { initProjectPackagePaths } from "./paths.js";
import {
  buildTemplateVariables,
  findUnresolvedTokens,
  readScaffoldTemplates,
  renderScaffoldTemplates,
  type RenderedScaffoldFile,
} from "./template-rendering.js";

export type { RenderedScaffoldFile };

export function renderScaffoldFiles(
  project: ProjectLayout,
  devModePackageRoot: string | undefined,
  betterAuthDevSecret: string = randomBytes(32).toString("base64url"),
  gettingStartedEnv: GettingStartedEnv = resolveGettingStartedEnv(),
  devPorts: DevPorts = randomDevPorts(),
): RenderedScaffoldFile[] {
  const initPaths = initProjectPackagePaths();
  const packages = resolveScaffoldPackages(initPaths, devModePackageRoot);
  const variables = buildTemplateVariables({
    project,
    packages,
    authCookiePrefix: createProjectAuthCookiePrefix(project.slug),
    betterAuthDevSecret,
    gettingStartedEnv,
    devPorts,
  });
  const files = renderScaffoldTemplates({
    templates: readScaffoldTemplates(initPaths),
    variables,
    // Keep one mode bit from package resolution through template rendering.
    // Generated files receive only the selected settings, never this internal
    // framework-development explanation.
    sourceLinkMode: packages.sourceLinkMode,
    pnpmOverrides: packages.pnpmOverrides,
  });
  const unresolved = findUnresolvedTokens(files);
  if (unresolved.length > 0) {
    const first = unresolved[0];
    throw new Error(
      `Generated scaffold file ${first.dest} contains unresolved template token ${first.token}.`,
    );
  }
  return files;
}

function createProjectAuthCookiePrefix(projectSlug: string): string {
  return `sapporta-${projectSlug}-${randomBytes(8).toString("hex")}`;
}
