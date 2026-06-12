/**
 * Centralized directory structure knowledge for Sapporta projects.
 *
 * Every path convention (segment names, nesting) lives here. Call sites
 * import these functions instead of constructing paths with inline strings.
 *
 * Two entry points mirror the two levels of "dir" in the codebase:
 *   - fromProjectRoot()  — given the root containing sapporta.json
 *   - fromApiCodeDir()   — given packages/api or packages/api/dist
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** The marker filename that identifies a Sapporta project root. */
export const PROJECT_MARKER = "sapporta.json";

/** Subdirectory names that the dev watcher should observe for hot-reload. */
export const WATCHABLE_SUBDIRS = ["app"] as const;

/**
 * Given a project root (containing sapporta.json), derive all standard paths.
 *
 * `apiDir` is where backend TypeScript sources live; `apiDistDir` is where
 * compiled JS lives at runtime. Frontend and shared packages sit beside the
 * API under packages/.
 */
export function fromProjectRoot(projectRoot: string) {
  const apiDir = join(projectRoot, "packages", "api");
  const apiDistDir = join(apiDir, "dist");
  const frontendDir = join(projectRoot, "packages", "frontend");
  const frontendDistDir = join(frontendDir, "dist");
  const sharedDir = join(projectRoot, "packages", "shared");
  const dataDir = join(projectRoot, "data");
  const databasePath = join(dataDir, "sqlite.db");
  const markerPath = join(projectRoot, PROJECT_MARKER);
  return {
    apiDir,
    apiDistDir,
    frontendDir,
    frontendDistDir,
    sharedDir,
    dataDir,
    databasePath,
    markerPath,
  };
}

/**
 * Given an API code directory (either packages/api or packages/api/dist), derive resource
 * subdirectories. The subdirectory names (`schema`, `app`) are
 * identical under both trees, so the same helper serves both the source-lint
 * path and the runtime-load path.
 */
export function fromApiCodeDir(codeDir: string) {
  return {
    schemaDir: join(codeDir, "schema"),
    appDir: join(codeDir, "app"),
  };
}

/** Derive project root from a database path (two levels up from data/sqlite.db). */
export function projectRootFromDbPath(databasePath: string): string {
  return dirname(dirname(databasePath));
}

/** Given a store directory and project ID, derive the database path. */
export function storeDbPath(storeDir: string, projectId: string): string {
  return join(storeDir, projectId, "data", "sqlite.db");
}

// ── Project root singleton (Rails.root analogue) ─────────────────────────────
//
// Holds the absolute path to the current Sapporta project root for the
// lifetime of the process. The generated `packages/api/boot.ts` calls
// `setProjectRoot` once at boot, before any user code runs. User code
// anywhere in the project — sub-apps under `packages/api/app/`,
// ad-hoc scripts — then reads it via `projectRoot()` /
// `projectPath(...)` without needing to plumb it through.
//
// This API is single-project per process by design. Multi-project hosts
// must not use it — the mismatch guard in `setProjectRoot` makes such
// misuse loud rather than silent.

const MAX_MARKER_WALK = 100;

/**
 * Walk up from `startDir` looking for a `sapporta.json` marker file.
 * Returns the directory containing the marker, or `null` if none found.
 *
 * Lives here (rather than in cli/find-project-root.ts) so this module
 * stays the single source of truth for path-and-marker knowledge.
 * cli/find-project-root.ts re-exports this.
 */
export function findProjectRootFrom(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (let i = 0; i < MAX_MARKER_WALK; i++) {
    if (existsSync(join(dir, PROJECT_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
  return null;
}

let _projectRoot: string | undefined;

/**
 * Publish the current project root. Called by the scaffolded `boot.ts`
 * before any user code runs.
 *
 * Idempotent for the same value. Re-setting to a *different* value throws —
 * this catches accidental use from multi-project hosts (where the singleton
 * model breaks down) instead of silently last-writer-wins.
 */
export function setProjectRoot(root: string): void {
  if (_projectRoot !== undefined && _projectRoot !== root) {
    throw new Error(
      `setProjectRoot called with a different root (${root}) after it was already set to ${_projectRoot}. ` +
        `This API is single-project per process; multi-project hosts must resolve paths explicitly.`,
    );
  }
  _projectRoot = root;
}

/**
 * The absolute path to the current Sapporta project root — Rails.root analogue.
 *
 * Use this from user app code (sub-apps under `packages/api/app/`) when you
 * need to read project-relative files. Do **not**
 * use `__dirname` / `import.meta.dirname` for asset paths — at runtime they
 * resolve under `dist/`, where non-TS assets (JSON, prompts, txt) don't exist.
 *
 * If `setProjectRoot` was not called (ad-hoc scripts, tests), lazily resolves
 * by walking up from `process.cwd()` looking for `sapporta.json`. Throws if
 * neither path produces a root.
 */
export function projectRoot(): string {
  if (_projectRoot !== undefined) return _projectRoot;
  const found = findProjectRootFrom(process.cwd());
  if (!found) {
    throw new Error(
      `projectRoot() called outside a Sapporta project: no ${PROJECT_MARKER} found walking up from ${process.cwd()}. ` +
        `Either run from inside a project directory or call setProjectRoot() at boot.`,
    );
  }
  _projectRoot = found;
  return found;
}

/**
 * Join path segments onto the project root. The Rails `Rails.root.join(...)`
 * analogue: `projectPath("user-config", "saved-mappings.json")`.
 */
export function projectPath(...segments: string[]): string {
  return join(projectRoot(), ...segments);
}

/** Test-only. Not exported from the package index. */
export function _resetProjectRootForTesting(): void {
  _projectRoot = undefined;
}
