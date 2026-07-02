import type { DependencyList } from "react";
import type { GridRuntime } from "../runtime";
import { useCommittedDisposableResource } from "./use-committed-disposable-resource";

// Own a GridRuntime from React. Construction runs after commit, replacement is
// controlled only by the dependency list, and render sees null while a newly
// requested runtime has not committed yet.
export function useGridRuntimeEffect(
  createRuntime: () => GridRuntime,
  deps: DependencyList,
): GridRuntime | null {
  return useCommittedDisposableResource(createRuntime, deps);
}
