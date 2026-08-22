import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectApiUrl } from "./project-api-url.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function makeProject(devEnv?: string): string {
  const root = mkdtempSync(join(tmpdir(), "sapporta-api-url-"));
  roots.push(root);
  writeFileSync(join(root, "sapporta.json"), "{}\n");
  if (devEnv !== undefined) {
    writeFileSync(join(root, ".env.development"), devEnv);
  }
  return root;
}

describe("readProjectApiUrl", () => {
  it("reads the API port the project configured", () => {
    const root = makeProject(
      "SAPPORTA_API_PORT=3117\nSAPPORTA_FRONTEND_PORT=5290\n",
    );
    expect(readProjectApiUrl(root)).toBe("http://localhost:3117");
  });

  it("finds the project from a directory inside it", () => {
    const root = makeProject("SAPPORTA_API_PORT=3117\n");
    const nested = join(root, "packages", "api");
    mkdirSync(nested, { recursive: true });
    expect(readProjectApiUrl(nested)).toBe("http://localhost:3117");
  });

  it("ignores the public app URL, which names a browser origin rather than the API", () => {
    const root = makeProject(
      "SAPPORTA_API_PORT=3117\nSAPPORTA_PUBLIC_APP_URL=https://app.example.com\n",
    );
    expect(readProjectApiUrl(root)).toBe("http://localhost:3117");
  });

  it("returns nothing outside a project", () => {
    const outside = mkdtempSync(join(tmpdir(), "sapporta-not-a-project-"));
    roots.push(outside);
    expect(readProjectApiUrl(outside)).toBeUndefined();
  });

  it("returns nothing when the project has no development env file", () => {
    expect(readProjectApiUrl(makeProject())).toBeUndefined();
  });

  it("returns nothing when the port is absent, blank, or not a port", () => {
    expect(
      readProjectApiUrl(makeProject("BETTER_AUTH_SECRET=x\n")),
    ).toBeUndefined();
    expect(
      readProjectApiUrl(makeProject("SAPPORTA_API_PORT=\n")),
    ).toBeUndefined();
    expect(
      readProjectApiUrl(makeProject("SAPPORTA_API_PORT=nope\n")),
    ).toBeUndefined();
    expect(
      readProjectApiUrl(makeProject("SAPPORTA_API_PORT=70000\n")),
    ).toBeUndefined();
  });
});
