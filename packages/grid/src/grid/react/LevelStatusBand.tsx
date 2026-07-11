// Per-path loading/error chrome.
//
// Subscribes only to the source's state — re-renders fire on status and
// error changes; row-data churn does NOT wake this
// component because the source emits one notification per snapshot
// transition and React bails out via `useSyncExternalStore` when the
// snapshot reference is unchanged. This is the chief reason the band
// exists as its own component instead of a fragment inside `<Grid>`.
//
// Renders nothing for `ready` / `idle`. Loading and error variants are
// one-line bands above the body. Errors include a "Retry" button wired
// to `source.query.refetch`; backend error text is surfaced verbatim per
// `packages/ui/CLAUDE.md`.

import type { LevelSourceState } from "../data-sources/types";
import type { GridPath } from "../types/identity";
import { useGridRuntime, useLevelSourceState } from "./GridRuntimeProvider";

export type StatusBandModel =
  | null
  | { kind: "loading"; text: string }
  | { kind: "error"; text: string };

// Pure decision logic. Tested directly so the component itself can stay
// a trivial wrapper around the model + the retry callback.
export function levelStatusBandModel(
  state: LevelSourceState,
  levelName: string,
): StatusBandModel {
  switch (state.status) {
    case "ready":
    case "refreshing":
    case "refreshError":
      return null;
    case "initialLoading":
      return { kind: "loading", text: `Loading ${levelName}…` };
    case "initialError": {
      // Backend error message, verbatim. The framing prefix ("Failed to
      // load <levelName>: ") is the UI's job; the message after the
      // colon is the server's words untouched.
      const message = state.error.message;
      return { kind: "error", text: `Failed to load ${levelName}: ${message}` };
    }
  }
}

export function LevelStatusBand({ path }: { path: GridPath }) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const state = useLevelSourceState(path);
  const levelName = level.schema.name;
  const model = levelStatusBandModel(state, levelName);
  if (!model) return null;

  if (model.kind === "loading") {
    return (
      <div
        data-grid-part="level-status"
        data-grid-status="loading"
        role="status"
        aria-live="polite"
        data-grid-path={path}
      >
        {model.text}
      </div>
    );
  }

  return (
    <div
      data-grid-part="level-status"
      data-grid-status="error"
      role="alert"
      data-grid-path={path}
    >
      <span>{model.text}</span>
      <button
        type="button"
        data-grid-part="level-status-retry"
        onClick={() => {
          void level.data.query?.refetch?.();
        }}
      >
        Retry
      </button>
    </div>
  );
}
