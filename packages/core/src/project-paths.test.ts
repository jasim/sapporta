import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PROJECT_MARKER,
  WATCHABLE_SUBDIRS,
  fromProjectRoot,
  fromApiCodeDir,
  projectRootFromDbPath,
  storeDbPath,
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
    expect(WATCHABLE_SUBDIRS).toEqual(["app", "reports"]);
  });

  it("fromProjectRoot derives all standard paths", () => {
    const paths = fromProjectRoot("/tmp/myproject");
    expect(paths).toEqual({
      apiDir: "/tmp/myproject/packages/api",
      apiDistDir: "/tmp/myproject/packages/api/dist",
      frontendDir: "/tmp/myproject/packages/frontend",
      frontendDistDir: "/tmp/myproject/packages/frontend/dist",
      sharedDir: "/tmp/myproject/packages/shared",
      dataDir: "/tmp/myproject/data",
      databasePath: "/tmp/myproject/data/sqlite.db",
      markerPath: "/tmp/myproject/sapporta.json",
    });
  });

  it("fromApiCodeDir derives resource subdirectories", () => {
    const dirs = fromApiCodeDir("/tmp/myproject/packages/api");
    expect(dirs).toEqual({
      schemaDir: "/tmp/myproject/packages/api/schema",
      appDir: "/tmp/myproject/packages/api/app",
      reportsDir: "/tmp/myproject/packages/api/reports",
    });
  });

  it("projectRootFromDbPath goes two levels up", () => {
    expect(projectRootFromDbPath("/store/proj1/data/sqlite.db")).toBe("/store/proj1");
  });

  it("storeDbPath constructs multi-project database path", () => {
    expect(storeDbPath("/store", "proj1")).toBe("/store/proj1/data/sqlite.db");
  });
});

describe("projectRoot singleton", () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    // realpathSync resolves macOS's /var → /private/var symlink so the
    // post-chdir cwd matches what we wrote the marker into.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "sapporta-root-")));
    originalCwd = process.cwd();
    _resetProjectRootForTesting();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    _resetProjectRootForTesting();
    rmSync(tmp, { recursive: true, force: true });
  });

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
    expect(() => setProjectRoot("/other/project")).toThrow(/single-project per process/);
  });

  it("projectRoot lazily resolves from cwd when not initialized", () => {
    writeFileSync(join(tmp, "sapporta.json"), "{}");
    process.chdir(tmp);
    expect(projectRoot()).toBe(tmp);
    // Subsequent calls return the cached value even if cwd changes.
    process.chdir(originalCwd);
    expect(projectRoot()).toBe(tmp);
  });

  it("projectRoot throws with a clear message when no marker is found", () => {
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
