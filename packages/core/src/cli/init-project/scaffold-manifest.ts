import { dirname, join } from "node:path";

export type ScaffoldFileOwnership = "framework" | "example" | "workspace";
export type RefreshPolicy = "overwrite" | "merge-package-json" | "skip";

export type ScaffoldFileSpec = {
  src: string;
  dest: string;
  ownership: ScaffoldFileOwnership;
  refreshPolicy: RefreshPolicy;
};

export type ScaffoldManifest = readonly ScaffoldFileSpec[];

function refreshPolicyForOwnership(
  ownership: ScaffoldFileOwnership,
  dest: string,
): RefreshPolicy {
  if (ownership === "workspace" && !isPackageJsonPath(dest)) {
    return "skip";
  }
  if (ownership === "workspace") {
    return "merge-package-json";
  }
  return "overwrite";
}

function scaffoldFile(
  path: string,
  ownership: ScaffoldFileOwnership,
): ScaffoldFileSpec {
  return {
    src: path,
    dest: path,
    ownership,
    refreshPolicy: refreshPolicyForOwnership(ownership, path),
  };
}

function scaffoldFileAt(
  src: string,
  dest: string,
  ownership: ScaffoldFileOwnership,
): ScaffoldFileSpec {
  return {
    src,
    dest,
    ownership,
    refreshPolicy: refreshPolicyForOwnership(ownership, dest),
  };
}

export const SCAFFOLD_MANIFEST: ScaffoldManifest = [
  scaffoldFile("packages/api/boot.ts", "framework"),
  scaffoldFile("packages/api/drizzle.config.ts", "framework"),
  scaffoldFile("packages/api/mailer.ts", "framework"),
  scaffoldFile("packages/api/app.ts", "example"),
  scaffoldFile("packages/api/app/hello.ts", "example"),
  scaffoldFile("packages/api/app/public-api-sample.ts", "example"),
  scaffoldFile("packages/api/authz/types.ts", "example"),
  scaffoldFile("packages/api/authz/ability.ts", "example"),
  scaffoldFile("packages/api/authz/request-data-authority.ts", "example"),
  scaffoldFile("packages/api/project-auth/index.ts", "framework"),
  scaffoldFile("packages/api/project-auth/better-auth.ts", "framework"),
  scaffoldFile("packages/api/project-auth/emails.ts", "framework"),
  scaffoldFile("packages/api/project-auth/options.ts", "workspace"),
  scaffoldFile("packages/api/project-auth/context.ts", "framework"),
  scaffoldFile("packages/api/project-auth/auth-tokens.ts", "framework"),
  scaffoldFile("packages/api/project-auth/workspace.ts", "framework"),
  scaffoldFile("packages/api/project-auth/routes.ts", "framework"),
  scaffoldFile("packages/api/project-auth/schema.ts", "framework"),
  scaffoldFile("packages/api/project-auth/env.ts", "framework"),
  scaffoldFile("packages/api/project-auth/middleware.ts", "framework"),
  scaffoldFile("packages/api/project-auth/errors.ts", "framework"),
  scaffoldFile("packages/api/package.json", "workspace"),
  scaffoldFile("packages/api/tsconfig.json", "framework"),
  scaffoldFile("package.json", "workspace"),
  scaffoldFile(".env.development", "workspace"),
  scaffoldFile(".env.production.example", "workspace"),
  scaffoldFile("scripts/dev.mjs", "workspace"),
  scaffoldFile("scripts/clean-dist.mjs", "workspace"),
  scaffoldFile("pnpm-workspace.yaml", "workspace"),
  scaffoldFile("Dockerfile", "workspace"),
  scaffoldFile(".dockerignore", "workspace"),
  scaffoldFile("README.md", "workspace"),
  scaffoldFile("AGENTS.md", "workspace"),
  scaffoldFile("CODING-PRINCIPLES.md", "workspace"),
  scaffoldFile("VISUAL-DESIGN-GUIDELINES.md", "workspace"),
  scaffoldFile("CLAUDE.md", "workspace"),
  scaffoldFile("DEPLOYMENT.md", "workspace"),
  scaffoldFileAt("gitignore", ".gitignore", "workspace"),
  scaffoldFile("packages/frontend/package.json", "workspace"),
  scaffoldFile("packages/frontend/tsconfig.json", "framework"),
  scaffoldFile("packages/frontend/vite.config.ts", "framework"),
  scaffoldFile("packages/frontend/index.html", "framework"),
  scaffoldFile("packages/frontend/src/main.tsx", "framework"),
  scaffoldFile("packages/frontend/src/query-client.ts", "workspace"),
  scaffoldFile("packages/frontend/src/SapportaApp.tsx", "framework"),
  scaffoldFile("packages/frontend/src/SapportaRoutes.tsx", "framework"),
  scaffoldFile("packages/frontend/src/App.tsx", "workspace"),
  scaffoldFile("packages/frontend/src/PublicPage.tsx", "example"),
  scaffoldFile("packages/frontend/src/Welcome.tsx", "example"),
  scaffoldFile("packages/frontend/src/api.ts", "framework"),
  scaffoldFile("packages/frontend/src/app.css", "example"),
  scaffoldFile("packages/frontend/src/vite-env.d.ts", "framework"),
  scaffoldFile("packages/shared/package.json", "workspace"),
  scaffoldFile("packages/shared/tsconfig.json", "framework"),
  scaffoldFile("packages/shared/src/index.ts", "example"),
  scaffoldFile("packages/shared/src/contracts/index.ts", "example"),
  scaffoldFile("packages/shared/src/contracts/hello.ts", "example"),
  scaffoldFile("packages/shared/src/contracts/public-api-sample.ts", "example"),
  scaffoldFile("packages/shared/AGENTS.md", "workspace"),
  scaffoldFile("packages/shared/CLAUDE.md", "workspace"),
];

export function packageJsonSpecs(
  manifest: ScaffoldManifest = SCAFFOLD_MANIFEST,
): ScaffoldFileSpec[] {
  return manifest.filter((file) => isPackageJsonPath(file.dest));
}

export function requiredRefreshPaths(
  manifest: ScaffoldManifest = SCAFFOLD_MANIFEST,
): string[] {
  return packageJsonSpecs(manifest).map((file) => file.dest);
}

export function directoriesRequiredByManifest(
  root: string,
  manifest: ScaffoldManifest = SCAFFOLD_MANIFEST,
): string[] {
  const dirs = new Set<string>([
    join(root, "data"),
    join(root, "scripts"),
    join(root, "packages/api"),
    join(root, "packages/api/app"),
    join(root, "packages/api/project-auth"),
    join(root, "packages/api/schema"),
    join(root, "packages/api/migrations"),
    join(root, "packages/frontend/src"),
    join(root, "packages/shared/src/contracts"),
  ]);
  for (const file of manifest) {
    dirs.add(dirname(join(root, file.dest)));
  }
  return [...dirs];
}

export function validateTemplateInventory(
  templatePaths: readonly string[],
  manifest: ScaffoldManifest = SCAFFOLD_MANIFEST,
  ignoredTemplates: readonly string[] = [],
): string[] {
  const expected = new Set([
    ...manifest.map((file) => file.src),
    ...ignoredTemplates,
  ]);
  return templatePaths.filter((path) => !expected.has(path));
}

function isPackageJsonPath(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}
