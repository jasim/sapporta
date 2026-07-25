import { describe, expect, it } from "vitest";
import { init, resolveInitProjectTarget } from "./init.js";

describe("init target validation", () => {
  it.each([
    ["my-app", "/tmp/workspace", "/tmp/workspace/my-app"],
    ["../apps/my-app", "/tmp/workspace", "/tmp/apps/my-app"],
    [
      "/tmp/sapporta apps/my-app",
      "/tmp/workspace",
      "/tmp/sapporta apps/my-app",
    ],
  ])(
    "resolves a project path and derives its package name: %s",
    (target, cwd, expectedDir) => {
      expect(resolveInitProjectTarget(target, cwd)).toEqual({
        projectDir: expectedDir,
        projectName: "my-app",
      });
    },
  );

  it("validates the target directory name instead of its parent path", async () => {
    const result = await init(["/tmp/sapporta apps/my app"]);

    expect(result).toEqual({
      ok: false,
      error:
        'Invalid project name "my app". Use only letters, numbers, hyphens, underscores, and dots. No spaces.',
      code: "INVALID_NAME",
    });
  });
});
