import { basename, dirname, join } from "node:path";
import { fromProjectRoot } from "../../project/project-paths.js";
import {
  directoriesRequiredByManifest,
  requiredRefreshPaths,
} from "./scaffold-manifest.js";

export type ProjectIdentity = {
  root: string;
  name: string;
  slug: string;
};

export type PackageLayout = {
  apiDir: string;
  frontendDir: string;
  sharedDir: string;
};

export type ProjectMarker = {
  dataDir: string;
  markerPath: string;
};

export type ProjectLayout = ProjectIdentity &
  PackageLayout &
  ProjectMarker & {
    packageJsonPath: string;
  };

export function projectNameFromOptions(opts: {
  dir: string;
  name?: string;
}): string {
  return opts.name ?? (basename(opts.dir) || "sapporta-project");
}

export function slugifyProjectName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function projectIdentityFromOptions(opts: {
  dir: string;
  name?: string;
}): ProjectIdentity {
  const name = projectNameFromOptions(opts);
  return {
    root: opts.dir,
    name,
    slug: slugifyProjectName(name),
  };
}

export function layoutForRoot(identity: ProjectIdentity): ProjectLayout {
  const paths = fromProjectRoot(identity.root);
  return {
    ...identity,
    packageJsonPath: join(identity.root, "package.json"),
    apiDir: paths.apiDir,
    frontendDir: paths.frontendDir,
    sharedDir: paths.sharedDir,
    dataDir: paths.dataDir,
    markerPath: paths.markerPath,
  };
}

export function requiredProjectPaths(): readonly string[] {
  return ["sapporta.json", ...requiredRefreshPaths()];
}

export function scaffoldDirectoriesFor(root: string): string[] {
  return directoriesRequiredByManifest(root);
}

export function stagingRootFor(
  projectRoot: string,
  nonce: string,
  pid: number = process.pid,
): string {
  const targetName = basename(projectRoot) || "sapporta-project";
  return join(
    dirname(projectRoot),
    `.${targetName}.sapporta-init-${pid}-${nonce}`,
  );
}

export function projectNameForMessage(targetRoot: string): string {
  return basename(targetRoot) || targetRoot;
}
