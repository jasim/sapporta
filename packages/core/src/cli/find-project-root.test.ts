import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot } from "./find-project-root.js";

describe("findProjectRoot", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "sapporta-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("finds sapporta.json in the starting directory", () => {
    writeFileSync(join(tmp, "sapporta.json"), "{}");
    expect(findProjectRoot(tmp)).toBe(tmp);
  });

  it("finds sapporta.json by walking up from a subdirectory", () => {
    writeFileSync(join(tmp, "sapporta.json"), "{}");
    const deep = join(tmp, "code", "src", "schema");
    mkdirSync(deep, { recursive: true });
    expect(findProjectRoot(deep)).toBe(tmp);
  });

  it("returns null when no sapporta.json exists", () => {
    expect(findProjectRoot(tmp)).toBeNull();
  });
});
