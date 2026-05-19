import { findProjectRootFrom } from "../project-paths.js";

/**
 * Walk up from `startDir` looking for a `sapporta.json` marker file.
 * Returns the directory containing the marker, or `null` if none found.
 *
 * The implementation lives in `project-paths.ts` (the single source of
 * truth for path-and-marker knowledge); this CLI-facing wrapper is kept
 * for backwards compatibility with existing call sites.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  return findProjectRootFrom(startDir);
}
