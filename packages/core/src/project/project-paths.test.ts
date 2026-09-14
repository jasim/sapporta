import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PROJECT_MARKER,
  WATCHABLE_SUBDIRS,
  fromProjectRoot,
  fromApiCodeDir,
  findProjectRootFrom,
  setProjectRoot,
  projectRoot,
  projectPath,
  _resetProjectRootForTesting,
} from "./project-paths.js";

describe("project-paths", () => {
  it("PROJECT_MARKER is sapporta.json", () => {
    expect(PROJECT_MARKER).toBe("sapporta.json");
  });

  it("WATCHABLE_SUBDIRS lists hot-reloadable directories", () => {
    expect(WATCHABLE_SUBDIRS).toEqual(["app"]);
  });

  it("fromProjectRoot derives all standard paths", () => {
    const paths = fromProjectRoot("/tmp/myproject");
    expect(paths).toEqual({
      apiDir: "/tmp/myproject/packages/api",
      apiDistDir: "/tmp/myproject/packages/api/dist",
      frontendDir: "/tmp/myproject/packages/frontend",
      frontendDistDir: "/tmp/myproject/packages/frontend/dist",
      sharedDir: "/tmp/myproject/packages/shared",
      markerPath: "/tmp/myproject/sapporta.json",
    });
  });

  it("fromApiCodeDir derives resource subdirectories", () => {
    const dirs = fromApiCodeDir("/tmp/myproject/packages/api");
    expect(dirs).toEqual({
      schemaDir: "/tmp/myproject/packages/api/schema",
      appDir: "/tmp/myproject/packages/api/app",
    });
  });
});

describe("projectRoot singleton", () => {
  let tmp: string;
  let originalCwd: string;
  let originalScript: string | undefined;

  beforeEach(() => {
    // realpathSync resolves macOS's /var → /private/var symlink so the
    // post-chdir cwd matches what we wrote the marker into.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "sapporta-root-")));
    originalCwd = process.cwd();
    originalScript = process.argv[1];
    _resetProjectRootForTesting();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.argv[1] = originalScript as string;
    _resetProjectRootForTesting();
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Writes an empty file at `path` and returns the path. */
  function writeScript(path: string): string {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "");
    return path;
  }

  it("findProjectRootFrom finds the marker by walking up", () => {
    writeFileSync(join(tmp, "sapporta.json"), "{}");
    const deep = join(tmp, "src", "app");
    mkdirSync(deep, { recursive: true });
    expect(findProjectRootFrom(deep)).toBe(tmp);
  });

  it("findProjectRootFrom returns null when no marker exists", () => {
    expect(findProjectRootFrom(tmp)).toBeNull();
  });

  it("setProjectRoot then projectRoot returns the value", () => {
    setProjectRoot("/some/project");
    expect(projectRoot()).toBe("/some/project");
  });

  it("setProjectRoot is idempotent for the same value", () => {
    setProjectRoot("/some/project");
    expect(() => setProjectRoot("/some/project")).not.toThrow();
    expect(projectRoot()).toBe("/some/project");
  });

  it("setProjectRoot throws when called with a different value", () => {
    setProjectRoot("/some/project");
    expect(() => setProjectRoot("/other/project")).toThrow(
      /single-project per process/,
    );
  });

  it("projectRoot lazily resolves from the started script, from any cwd", () => {
    // Code at the top of a module boot.ts imports runs before runtime.ts sets
    // the root, and the server may be started from any directory.
    const app = join(tmp, "app");
    mkdirSync(app);
    writeFileSync(join(app, "sapporta.json"), "{}");
    process.argv[1] = writeScript(join(app, "packages/api/dist/boot.js"));
    const elsewhere = join(tmp, "elsewhere");
    mkdirSync(elsewhere);
    process.chdir(elsewhere);

    expect(projectRoot()).toBe(app);
    // The root it finds is the one runtime.ts sets, so setting it passes.
    expect(() => setProjectRoot(app)).not.toThrow();
  });

  it("projectRoot prefers the started script's project over the cwd's", () => {
    const app = join(tmp, "app");
    const other = join(tmp, "other");
    mkdirSync(app);
    mkdirSync(other);
    writeFileSync(join(app, "sapporta.json"), "{}");
    writeFileSync(join(other, "sapporta.json"), "{}");
    process.argv[1] = writeScript(join(app, "packages/api/dist/boot.js"));
    process.chdir(other);

    expect(projectRoot()).toBe(app);
  });

  it("projectRoot resolves the started script through symlinks", () => {
    const app = join(tmp, "app");
    mkdirSync(app);
    writeFileSync(join(app, "sapporta.json"), "{}");
    const boot = writeScript(join(app, "packages/api/dist/boot.js"));
    const link = join(tmp, "linked-app");
    symlinkSync(app, link);
    process.argv[1] = join(link, "packages/api/dist/boot.js");
    process.chdir(tmp);

    expect(realpathSync(process.argv[1])).toBe(boot);
    expect(projectRoot()).toBe(app);
  });

  it("projectRoot lazily resolves from cwd when the script is outside a project", () => {
    process.argv[1] = writeScript(join(tmp, "tools", "script.js"));
    const project = join(tmp, "project");
    mkdirSync(project);
    writeFileSync(join(project, "sapporta.json"), "{}");
    process.chdir(project);
    expect(projectRoot()).toBe(project);
    // Subsequent calls return the cached value even if cwd changes.
    process.chdir(originalCwd);
    expect(projectRoot()).toBe(project);
  });

  it("projectRoot lazily resolves from cwd when there is no started script", () => {
    process.argv[1] = "";
    writeFileSync(join(tmp, "sapporta.json"), "{}");
    process.chdir(tmp);
    expect(projectRoot()).toBe(tmp);
  });

  it("projectRoot throws with a clear message when no marker is found", () => {
    process.argv[1] = writeScript(join(tmp, "tools", "script.js"));
    process.chdir(tmp);
    expect(() => projectRoot()).toThrow(/no sapporta\.json found/);
  });

  it("projectPath joins segments onto the project root", () => {
    setProjectRoot("/some/project");
    expect(projectPath("user-config", "saved-mappings.json")).toBe(
      "/some/project/user-config/saved-mappings.json",
    );
  });
});
