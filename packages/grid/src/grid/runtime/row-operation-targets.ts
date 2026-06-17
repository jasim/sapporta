import type { GridRuntime } from "./create-grid-runtime";

type RowOperationTarget = ReturnType<
  GridRuntime["rowOperationTargetsFor"]
>[number];

export function collectRowOperationTargets(
  runtime: GridRuntime,
): RowOperationTarget[] {
  const targets: RowOperationTarget[] = [];
  for (const path of runtime.registeredPaths()) {
    targets.push(...runtime.rowOperationTargetsFor(path));
  }
  return targets;
}
