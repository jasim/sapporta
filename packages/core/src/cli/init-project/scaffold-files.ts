export type ScaffoldFileOwnership = "framework" | "example" | "workspace";

export type ScaffoldFile = {
  src: string;
  dest: string;
  ownership: ScaffoldFileOwnership;
};

function scaffoldFile(
  path: string,
  ownership: ScaffoldFileOwnership,
): ScaffoldFile {
  return { src: path, dest: path, ownership };
}

export const SCAFFOLD_FILES: ScaffoldFile[] = [
  scaffoldFile("packages/api/boot.ts", "framework"),
  scaffoldFile("packages/api/drizzle.config.ts", "framework"),
  {
    src: "mailer.ts",
    dest: "packages/api/mailer.ts",
    ownership: "framework",
  },
  scaffoldFile("packages/api/app.ts", "example"),
  scaffoldFile("packages/api/app/hello.ts", "example"),
  {
    src: "project-auth/index.ts",
    dest: "packages/api/project-auth/index.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/better-auth.ts",
    dest: "packages/api/project-auth/better-auth.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/emails.ts",
    dest: "packages/api/project-auth/emails.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/options.ts",
    dest: "packages/api/project-auth/options.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/context.ts",
    dest: "packages/api/project-auth/context.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/workspace.ts",
    dest: "packages/api/project-auth/workspace.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/routes.ts",
    dest: "packages/api/project-auth/routes.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/schema.ts",
    dest: "packages/api/project-auth/schema.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/env.ts",
    dest: "packages/api/project-auth/env.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/middleware.ts",
    dest: "packages/api/project-auth/middleware.ts",
    ownership: "framework",
  },
  {
    src: "project-auth/errors.ts",
    dest: "packages/api/project-auth/errors.ts",
    ownership: "framework",
  },
  scaffoldFile("packages/api/package.json", "workspace"),
  scaffoldFile("packages/api/tsconfig.json", "framework"),
  scaffoldFile("package.json", "workspace"),
  scaffoldFile(".env.development", "workspace"),
  scaffoldFile(".env.production.example", "workspace"),
  scaffoldFile("scripts/dev.mjs", "workspace"),
  scaffoldFile("pnpm-workspace.yaml", "workspace"),
  scaffoldFile("Dockerfile", "workspace"),
  scaffoldFile(".dockerignore", "workspace"),
  scaffoldFile("README.md", "workspace"),
  scaffoldFile("DEPLOYMENT.md", "workspace"),
  { src: "gitignore", dest: ".gitignore", ownership: "workspace" },
  scaffoldFile("packages/frontend/package.json", "workspace"),
  scaffoldFile("packages/frontend/tsconfig.json", "framework"),
  scaffoldFile("packages/frontend/vite.config.ts", "framework"),
  scaffoldFile("packages/frontend/index.html", "framework"),
  scaffoldFile("packages/frontend/src/main.tsx", "framework"),
  scaffoldFile("packages/frontend/src/SapportaRoutes.tsx", "framework"),
  scaffoldFile("packages/frontend/src/App.tsx", "workspace"),
  scaffoldFile("packages/frontend/src/Sidebar.tsx", "example"),
  scaffoldFile("packages/frontend/src/Welcome.tsx", "example"),
  scaffoldFile("packages/frontend/src/api.ts", "framework"),
  scaffoldFile("packages/frontend/src/app.css", "example"),
  scaffoldFile("packages/frontend/src/vite-env.d.ts", "framework"),
  scaffoldFile("packages/shared/package.json", "workspace"),
  scaffoldFile("packages/shared/tsconfig.json", "framework"),
  scaffoldFile("packages/shared/src/index.ts", "example"),
  scaffoldFile("packages/shared/src/contracts/index.ts", "example"),
  scaffoldFile("packages/shared/src/contracts/hello.ts", "example"),
  scaffoldFile("packages/shared/CLAUDE.md", "workspace"),
];
