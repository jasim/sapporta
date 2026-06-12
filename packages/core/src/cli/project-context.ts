import { OperationError, ErrorCode } from "../introspect/types.js";
import { findProjectRoot } from "./find-project-root.js";
import { fromProjectRoot, setProjectRoot } from "../project-paths.js";

/**
 * Project context resolved from flags or filesystem detection.
 * Directory-based resolution — no Postgres registry dependency.
 */
export interface ProjectContext {
  databasePath: string;
  dir: string | null;
}

/**
 * Resolve project context from CLI flags or filesystem walk.
 *
 * Resolution order:
 *   1. --sapporta-project-dir flag
 *   2. Walk up from cwd looking for sapporta.json
 *
 * From the project root we derive packages/api/dist/ (compiled
 * schema/app, what the runtime loads) and data/sqlite.db (database).
 */
export async function resolveProjectContext(
  flags: Record<string, string>,
): Promise<ProjectContext> {
  const projectDir = flags["sapporta-project-dir"] ?? findProjectRoot();

  if (!projectDir) {
    throw new OperationError(
      "No Sapporta project found. Use --sapporta-project-dir or run from within a project directory (containing sapporta.json)",
      ErrorCode.PROJECT_NOT_FOUND,
    );
  }

  setProjectRoot(projectDir);
  const { apiDistDir, databasePath } = fromProjectRoot(projectDir);

  return { databasePath, dir: apiDistDir };
}
