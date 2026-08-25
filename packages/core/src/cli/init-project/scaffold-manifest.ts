import { dirname, join } from "node:path";

export type ScaffoldFileSpec = {
  src: string;
  dest: string;
};

export type ScaffoldManifest = readonly ScaffoldFileSpec[];

function scaffoldFile(dest: string): ScaffoldFileSpec {
  return {
    src: templateSrcForDest(dest),
    dest,
  };
}

/**
 * The template tree mirrors the generated project, so a file's template
 * source path is its destination path. The one exception is .gitignore:
 * npm strips files named .gitignore when packing, so the template ships
 * without the leading dot and is renamed at scaffold time.
 */
function templateSrcForDest(dest: string): string {
  return dest === ".gitignore" ? "gitignore" : dest;
}

export const SCAFFOLD_MANIFEST: ScaffoldManifest = [
  scaffoldFile("packages/api/boot.ts"),
  scaffoldFile("packages/api/runtime.ts"),
  scaffoldFile("packages/api/script-runtime.ts"),
  scaffoldFile("packages/api/seed-runtime.ts"),
  scaffoldFile("packages/api/seed.ts"),
  scaffoldFile("packages/api/drizzle.config.ts"),
  scaffoldFile("packages/api/mailer.ts"),
  scaffoldFile("packages/api/app.ts"),
  scaffoldFile("packages/api/app/hello.ts"),
  scaffoldFile("packages/api/app/public-api-sample.ts"),
  scaffoldFile("packages/api/authz/types.ts"),
  scaffoldFile("packages/api/authz/ability.ts"),
  scaffoldFile("packages/api/authz/request-data-authority.ts"),
  scaffoldFile("packages/api/project-auth/index.ts"),
  scaffoldFile("packages/api/project-auth/better-auth.ts"),
  scaffoldFile("packages/api/project-auth/emails.ts"),
  scaffoldFile("packages/api/project-auth/options.ts"),
  scaffoldFile("packages/api/project-auth/context.ts"),
  scaffoldFile("packages/api/project-auth/auth-tokens.ts"),
  scaffoldFile("packages/api/project-auth/auth-tokens-schema.ts"),
  scaffoldFile("packages/api/project-auth/sample-data.ts"),
  scaffoldFile("packages/api/project-auth/user.ts"),
  scaffoldFile("packages/api/project-auth/workspace.ts"),
  scaffoldFile("packages/api/project-auth/routes.ts"),
  scaffoldFile("packages/api/project-auth/schema.ts"),
  scaffoldFile("packages/api/project-auth/env.ts"),
  scaffoldFile("packages/api/project-auth/middleware.ts"),
  scaffoldFile("packages/api/project-auth/errors.ts"),
  scaffoldFile("packages/api/package.json"),
  scaffoldFile("packages/api/tsconfig.json"),
  scaffoldFile("package.json"),
  scaffoldFile(".env.development"),
  scaffoldFile(".env.production.example"),
  scaffoldFile("scripts/dev.mjs"),
  scaffoldFile("scripts/clean-dist.mjs"),
  scaffoldFile("pnpm-workspace.yaml"),
  scaffoldFile("Dockerfile"),
  scaffoldFile(".dockerignore"),
  scaffoldFile("README.md"),
  scaffoldFile("AGENTS.md"),
  scaffoldFile("CODING-PRINCIPLES.md"),
  scaffoldFile("VISUAL-DESIGN-GUIDELINES.md"),
  scaffoldFile("CLAUDE.md"),
  scaffoldFile("DEPLOYMENT.md"),
  scaffoldFile(".gitignore"),
  scaffoldFile("packages/frontend/package.json"),
  scaffoldFile("packages/frontend/tsconfig.json"),
  scaffoldFile("packages/frontend/vite.config.ts"),
  scaffoldFile("packages/frontend/index.html"),
  scaffoldFile("packages/frontend/src/main.tsx"),
  scaffoldFile("packages/frontend/src/query-client.ts"),
  scaffoldFile("packages/frontend/src/SapportaApp.tsx"),
  scaffoldFile("packages/frontend/src/SapportaRoutes.tsx"),
  scaffoldFile("packages/frontend/src/App.tsx"),
  scaffoldFile("packages/frontend/src/PublicPage.tsx"),
  scaffoldFile("packages/frontend/src/Home.tsx"),
  scaffoldFile("packages/frontend/src/api.ts"),
  scaffoldFile("packages/frontend/src/app.css"),
  scaffoldFile("packages/frontend/src/vite-env.d.ts"),
  scaffoldFile("packages/shared/package.json"),
  scaffoldFile("packages/shared/tsconfig.json"),
  scaffoldFile("packages/shared/src/index.ts"),
  scaffoldFile("packages/shared/src/contracts/index.ts"),
  scaffoldFile("packages/shared/src/contracts/hello.ts"),
  scaffoldFile("packages/shared/src/contracts/public-api-sample.ts"),
  scaffoldFile("packages/shared/AGENTS.md"),
  scaffoldFile("packages/shared/CLAUDE.md"),
];

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
