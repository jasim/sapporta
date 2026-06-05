import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergePackageJson, refreshScaffoldProject } from "./refresh-project.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("mergePackageJson", () => {
  it("preserves local scripts and dependencies while updating scaffold dependencies", () => {
    expect(
      mergePackageJson(
        {
          name: "existing-name",
          scripts: { dev: "custom-dev", local: "node local.mjs" },
          dependencies: {
            "@sapporta/server": "old",
            "local-runtime": "1.0.0",
          },
          devDependencies: { "local-tool": "1.0.0" },
          customField: true,
        },
        {
          name: "scaffold-name",
          scripts: { dev: "scaffold-dev", build: "scaffold-build" },
          dependencies: {
            "@sapporta/server": "new",
            hono: "^4.0.0",
          },
          devDependencies: { typescript: "^5.7.0" },
          type: "module",
        },
      ),
    ).toEqual({
      name: "existing-name",
      scripts: { dev: "custom-dev", local: "node local.mjs" },
      dependencies: {
        "@sapporta/server": "new",
        "local-runtime": "1.0.0",
        hono: "^4.0.0",
      },
      devDependencies: {
        "local-tool": "1.0.0",
        typescript: "^5.7.0",
      },
      customField: true,
      type: "module",
    });
  });
});

describe("refreshScaffoldProject", () => {
  it("rejects non-project targets before writing", () => {
    const target = makeTempDir();
    writeFileSync(join(target, "package.json"), "{}\n");

    expect(() =>
      refreshScaffoldProject({
        projectDir: target,
        mode: "write",
        devModePackageRoot: process.cwd(),
      }),
    ).toThrow(/Missing: sapporta\.json/);
    expect(readFileSync(join(target, "package.json"), "utf-8")).toBe("{}\n");
  });

  it("refreshes framework and example files plus package dependencies", () => {
    const target = createTargetProject();
    writeFileSync(join(target, "packages/api/boot.ts"), "custom boot\n");
    writeFileSync(join(target, "packages/api/app.ts"), "custom app mount\n");
    writeFileSync(
      join(target, "packages/frontend/src/App.tsx"),
      "custom app ui\n",
    );
    writeFileSync(
      join(target, "packages/frontend/src/SapportaRoutes.tsx"),
      "custom framework ui\n",
    );
    writeFileSync(join(target, "packages/api/schema/accounts.ts"), "schema\n");
    writeFileSync(join(target, "packages/api/reports/ledger.ts"), "report\n");

    const summary = refreshScaffoldProject({
      projectDir: target,
      mode: "write",
      devModePackageRoot: process.cwd(),
    });

    expect(summary.overwritten).toContain("packages/api/boot.ts");
    expect(summary.overwritten).toContain("packages/api/app.ts");
    expect(summary.overwritten).toContain(
      "packages/frontend/src/SapportaRoutes.tsx",
    );
    expect(summary.skipped).toContain(
      "packages/frontend/src/App.tsx (workspace)",
    );
    expect(summary.created).toContain("packages/frontend/src/api.ts");
    expect(summary.merged).toContain("packages/api/package.json");
    expect(
      readFileSync(join(target, "packages/api/boot.ts"), "utf-8"),
    ).toContain("Application entry point.");
    expect(
      readFileSync(join(target, "packages/api/app.ts"), "utf-8"),
    ).toContain('app.route("/", helloApi)');
    expect(
      readFileSync(join(target, "packages/frontend/src/App.tsx"), "utf-8"),
    ).toBe("custom app ui\n");
    expect(
      readFileSync(
        join(target, "packages/frontend/src/SapportaRoutes.tsx"),
        "utf-8",
      ),
    ).toContain("sapportaProtectedRoutes");
    expect(
      readFileSync(join(target, "packages/api/schema/accounts.ts"), "utf-8"),
    ).toBe("schema\n");
    expect(
      readFileSync(join(target, "packages/api/reports/ledger.ts"), "utf-8"),
    ).toBe("report\n");
    expect(existsSync(join(target, "packages/frontend/src/api.ts"))).toBe(true);

    const apiPackageJson = JSON.parse(
      readFileSync(join(target, "packages/api/package.json"), "utf-8"),
    ) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(apiPackageJson.name).toBe("custom-api");
    expect(apiPackageJson.scripts).toEqual({ dev: "custom dev" });
    expect(apiPackageJson.dependencies["local-runtime"]).toBe("1.0.0");
    expect(apiPackageJson.dependencies["@sapporta/server"]).toMatch(/^link:/);
  });

  it("reports dry-run changes without writing files", () => {
    const target = createTargetProject();
    writeFileSync(join(target, "packages/api/boot.ts"), "custom boot\n");

    const summary = refreshScaffoldProject({
      projectDir: target,
      mode: "dry-run",
      devModePackageRoot: process.cwd(),
    });

    expect(summary.overwritten).toContain("packages/api/boot.ts");
    expect(readFileSync(join(target, "packages/api/boot.ts"), "utf-8")).toBe(
      "custom boot\n",
    );
    expect(existsSync(join(target, "packages/frontend/src/api.ts"))).toBe(
      false,
    );
  });
});

function createTargetProject(): string {
  const target = makeTempDir();
  mkdirSync(join(target, "packages/api/schema"), { recursive: true });
  mkdirSync(join(target, "packages/api/reports"), { recursive: true });
  mkdirSync(join(target, "packages/frontend/src"), { recursive: true });
  mkdirSync(join(target, "packages/shared"), { recursive: true });
  writeFileSync(join(target, "sapporta.json"), "{}\n");
  writeJson(join(target, "package.json"), {
    name: "custom-root",
    scripts: { dev: "custom root dev" },
    devDependencies: { "local-tool": "1.0.0" },
  });
  writeJson(join(target, "packages/api/package.json"), {
    name: "custom-api",
    scripts: { dev: "custom dev" },
    dependencies: {
      "@sapporta/server": "old",
      "local-runtime": "1.0.0",
    },
  });
  writeJson(join(target, "packages/frontend/package.json"), {
    name: "custom-frontend",
  });
  writeJson(join(target, "packages/shared/package.json"), {
    name: "custom-shared",
  });
  return target;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "sapporta-refresh-test-"));
  tempRoots.push(root);
  return root;
}
