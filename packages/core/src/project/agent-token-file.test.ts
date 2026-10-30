import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationError } from "../errors.js";
import {
  PROJECT_API_TOKEN_FILE,
  readProjectApiToken,
  writeProjectApiToken,
} from "./agent-token-file.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function makeProject(agentEnv?: string): string {
  const root = mkdtempSync(join(tmpdir(), "sapporta-api-token-"));
  roots.push(root);
  writeFileSync(join(root, "sapporta.json"), "{}\n");
  if (agentEnv !== undefined) {
    writeFileSync(join(root, PROJECT_API_TOKEN_FILE), agentEnv);
  }
  return root;
}

describe("readProjectApiToken", () => {
  it("reads the token and nothing else", () => {
    const root = makeProject(
      "# sample\nSAPPORTA_API_URL=http://localhost:3000\nSAPPORTA_API_TOKEN=spat_050505_secret\n",
    );
    expect(readProjectApiToken(root)).toBe("spat_050505_secret");
  });

  it("is undefined with no file, no token or a blank one", () => {
    expect(readProjectApiToken(makeProject())).toBeUndefined();
    expect(readProjectApiToken(makeProject("# sample\n"))).toBeUndefined();
    expect(
      readProjectApiToken(makeProject("SAPPORTA_API_TOKEN=\n")),
    ).toBeUndefined();
  });

  it("names the file when it exists but cannot be read", () => {
    const root = makeProject();
    mkdirSync(join(root, PROJECT_API_TOKEN_FILE));
    expect(() => readProjectApiToken(root)).toThrow(OperationError);
    expect(() => readProjectApiToken(root)).toThrow(
      join(root, PROJECT_API_TOKEN_FILE),
    );
  });
});

describe("writeProjectApiToken", () => {
  it("writes what the reader reads, owner-only, replacing an older file", () => {
    const root = makeProject("SAPPORTA_API_TOKEN=spat_050505_old\n");
    const path = join(root, PROJECT_API_TOKEN_FILE);
    chmodSync(path, 0o644);
    writeProjectApiToken(root, "spat_050505_new", ["Written by sample"]);

    expect(readFileSync(path, "utf-8")).toBe(
      "# Written by sample\n\nSAPPORTA_API_TOKEN=spat_050505_new\n",
    );
    expect(readProjectApiToken(root)).toBe("spat_050505_new");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(root).sort()).toEqual(
      [PROJECT_API_TOKEN_FILE, "sapporta.json"].sort(),
    );
  });

  it("replaces a symlink at its path instead of writing through it", () => {
    const root = makeProject();
    const target = join(root, "elsewhere");
    writeFileSync(target, "untouched\n");
    symlinkSync(target, join(root, PROJECT_API_TOKEN_FILE));

    writeProjectApiToken(root, "spat_050505_new");

    expect(readFileSync(target, "utf-8")).toBe("untouched\n");
    expect(lstatSync(join(root, PROJECT_API_TOKEN_FILE)).isFile()).toBe(true);
    expect(readProjectApiToken(root)).toBe("spat_050505_new");
  });

  it("refuses a token the file would not read back", () => {
    const root = makeProject();
    for (const token of ["", " spat_x", "spat_a#b", '"spat_x"', "a\nb"]) {
      expect(() => writeProjectApiToken(root, token)).toThrow();
    }
    expect(readProjectApiToken(root)).toBeUndefined();
  });

  it("refuses a comment that spans lines", () => {
    const root = makeProject();
    expect(() =>
      writeProjectApiToken(root, "spat_050505_new", ["one\nSAPPORTA_API_TOKEN=x"]),
    ).toThrow();
    expect(readProjectApiToken(root)).toBeUndefined();
  });
});
