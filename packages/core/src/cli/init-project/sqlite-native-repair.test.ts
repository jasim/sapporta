import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  isMissingBetterSqlite3Binding,
  resolveBetterSqlite3Install,
  type CommandResult,
} from "./sqlite-native-repair.js";

const tempDirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "sapporta-create-project-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("isMissingBetterSqlite3Binding", () => {
  it("recognizes the native binding lookup error", () => {
    const result: CommandResult = {
      status: 1,
      signal: null,
      stdout: "",
      stderr: "Error: Could not locate the bindings file. Tried:\n -> /x/build/Release/better_sqlite3.node",
    };

    expect(isMissingBetterSqlite3Binding(result)).toBe(true);
  });

  it("does not classify unrelated failures as native binding failures", () => {
    const result: CommandResult = {
      status: 1,
      signal: null,
      stdout: "",
      stderr: "SyntaxError: Unexpected token",
    };

    expect(isMissingBetterSqlite3Binding(result)).toBe(false);
  });
});

describe("resolveBetterSqlite3Install", () => {
  it("returns the installed package directory and exact version", () => {
    const projectRoot = tempProject();
    const packageDir = join(projectRoot, "node_modules", "better-sqlite3");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "better-sqlite3", version: "12.10.0" }),
    );

    expect(resolveBetterSqlite3Install(projectRoot)).toEqual({
      dir: realpathSync(packageDir),
      version: "12.10.0",
    });
  });
});
