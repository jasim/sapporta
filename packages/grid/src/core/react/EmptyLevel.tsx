// Empty-state chrome.
//
// Renders only when the source is `ready` AND there are no rows, no
// phantoms, and no footer rows. While loading or in error, the
// `<LevelStatusBand>` covers the slot — this component must NOT render
// during those states or it would double up with the band.

import type { LevelSourceState } from "../data-sources/types";
import type { GridPath } from "../types/identity";
import {
  useGridRuntime,
  useLevelSourceState,
  usePhantoms,
} from "./GridRuntimeProvider";

// Pure decision logic. Lifted out so tests can drive the four
// guard conditions without a renderer.
export function shouldRenderEmpty(
  state: LevelSourceState,
  phantomCount: number,
): boolean {
  if (state.status !== "ready") return false;
  if (state.snapshot.nodes.length > 0) return false;
  if (phantomCount > 0) return false;
  if ((state.snapshot.footerRows?.length ?? 0) > 0) return false;
  return true;
}

export function EmptyLevel({ path }: { path: GridPath }) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const state = useLevelSourceState(path);
  const phantoms = usePhantoms(path);
  if (!shouldRenderEmpty(state, phantoms.length)) return null;
  const levelName = level.schema.name;
  return (
    <div data-grid-part="level-empty" role="status" data-grid-path={path}>
      No {levelName}.
    </div>
  );
}
