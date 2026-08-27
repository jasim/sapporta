import { isAbsolute, normalize } from "node:path";

export const DEFAULT_DOCS_ORIGIN = "https://sapporta.com";
export const DEFAULT_SKILL_SOURCE = "https://github.com/jasim/sapporta-skills";

const DOCS_ORIGIN = "SAPPORTA_DOCS_ORIGIN";
const SKILL_SOURCE = "SAPPORTA_SKILL_SOURCE";

export type GettingStartedEnv = Readonly<{
  docsOrigin: string;
  docsBrowserUrl: string;
  skillSource: string;
}>;

export function resolveGettingStartedEnv(
  env: Record<string, string | undefined> = process.env,
): GettingStartedEnv {
  const docsOrigin = readOrigin(
    env[DOCS_ORIGIN] ?? DEFAULT_DOCS_ORIGIN,
    DOCS_ORIGIN,
  );
  const skillSource = readSkillSource(
    env[SKILL_SOURCE] ?? DEFAULT_SKILL_SOURCE,
    SKILL_SOURCE,
  );

  return Object.freeze({
    docsOrigin,
    docsBrowserUrl: `${docsOrigin}/docs/getting-started/introduction/`,
    skillSource,
  });
}

function readOrigin(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }
  return parsed.origin;
}

function readSkillSource(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  if (isAbsolute(normalized)) return normalize(normalized);

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      `${name} must be an absolute filesystem path or HTTP(S) URL`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error(
      `${name} must be an absolute filesystem path or HTTP(S) URL`,
    );
  }
  return parsed.href.replace(/\/$/, "");
}
