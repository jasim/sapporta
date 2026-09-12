import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dataPath, databasePath } from "./data-dir.js";
import {
  _resetProjectRootForTesting,
  setProjectRoot,
} from "./project-paths.js";

describe("data-dir", () => {
  let originalCwd: string;
  let tmp: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "sapporta-data-dir-")));
    _resetProjectRootForTesting();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    _resetProjectRootForTesting();
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("joins segments onto an absolute SAPPORTA_DATA_DIR", () => {
    vi.stubEnv("SAPPORTA_DATA_DIR", "/srv/customer-a");
    expect(dataPath()).toBe("/srv/customer-a");
    expect(dataPath("user-config", "import-presets.json")).toBe(
      "/srv/customer-a/user-config/import-presets.json",
    );
  });

  it("places the database in the data directory", () => {
    vi.stubEnv("SAPPORTA_DATA_DIR", "/srv/customer-a");
    expect(databasePath()).toBe("/srv/customer-a/sqlite.db");
  });

  it("uses an absolute SAPPORTA_DATA_DIR outside any project", () => {
    // tmp has no sapporta.json, so a project root cannot be found from here.
    process.chdir(tmp);
    vi.stubEnv("SAPPORTA_DATA_DIR", "/srv/customer-a");
    expect(databasePath()).toBe("/srv/customer-a/sqlite.db");
  });

  it("resolves a relative SAPPORTA_DATA_DIR against the project root, not the working directory", () => {
    setProjectRoot("/some/project");
    process.chdir(tmp);
    vi.stubEnv("SAPPORTA_DATA_DIR", "data");
    expect(databasePath()).toBe("/some/project/data/sqlite.db");

    vi.stubEnv("SAPPORTA_DATA_DIR", "../sample-data");
    expect(databasePath()).toBe("/some/sample-data/sqlite.db");
  });

  it("throws when SAPPORTA_DATA_DIR is unset", () => {
    vi.stubEnv("SAPPORTA_DATA_DIR", undefined);
    expect(() => databasePath()).toThrow("SAPPORTA_DATA_DIR is not set.");
  });

  it("throws when SAPPORTA_DATA_DIR is empty", () => {
    vi.stubEnv("SAPPORTA_DATA_DIR", "");
    expect(() => databasePath()).toThrow("SAPPORTA_DATA_DIR is not set.");
  });
});
