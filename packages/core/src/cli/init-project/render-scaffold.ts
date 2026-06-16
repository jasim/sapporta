import { randomBytes } from "node:crypto";
import { resolveScaffoldPackages } from "./dependency-catalog.js";
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
): RenderedScaffoldFile[] {
  const initPaths = initProjectPackagePaths();
  const packages = resolveScaffoldPackages(initPaths, devModePackageRoot);
  const variables = buildTemplateVariables({
    project,
    packages,
    betterAuthDevSecret,
  });
  const files = renderScaffoldTemplates({
    templates: readScaffoldTemplates(initPaths),
    variables,
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
