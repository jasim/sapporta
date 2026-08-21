import type { ColId, GridPath, GridRuntime } from "../core";
import type { ValueLookup } from "./cache/value-lookup";

export type GridValueLookupColumn = {
  colId: ColId;
  valueLookup: ValueLookup;
};

export function startLoadingValueLookupEntriesForGridRows(args: {
  runtime: GridRuntime;
  lookupColumnsForGridPath: (
    path: GridPath,
  ) => readonly GridValueLookupColumn[];
}): () => void {
  let stopped = false;
  const subscriptions = new Map<GridPath, () => void>();
  const lastNodesByPath = new Map<GridPath, unknown>();

  function syncKnownLevels(): void {
    if (stopped) return;

    const levels = args.runtime.registeredLevels();
    const registeredPaths = new Set(levels.map((level) => level.path));

    for (const [path, unsubscribe] of subscriptions) {
      if (registeredPaths.has(path)) continue;
      unsubscribe();
      subscriptions.delete(path);
      lastNodesByPath.delete(path);
    }

    for (const level of levels) {
      const { path } = level;
      if (subscriptions.has(path)) continue;

      const source = level.data;
      const loadForPath = () => {
        if (stopped) return;

        const state = source.state();
        if (state.status !== "ready") return;
        const snapshot = state.snapshot;
        if (lastNodesByPath.get(path) === snapshot.nodes) return;
        lastNodesByPath.set(path, snapshot.nodes);

        for (const { colId, valueLookup } of args.lookupColumnsForGridPath(
          path,
        )) {
          const values = snapshot.nodes.map((node) => node.columns[colId]);
          try {
            void valueLookup.loadMissingEntries(values).catch(() => {
              // Best-effort display loading: cells can still render raw values.
            });
          } catch {
            // Best-effort display loading: cells can still render raw values.
          }
        }
      };

      subscriptions.set(path, source.subscribe(loadForPath));
      loadForPath();
    }
  }

  syncKnownLevels();
  const unsubscribeLevels = args.runtime.subscribeLevels(syncKnownLevels);

  return () => {
    stopped = true;
    unsubscribeLevels();
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    lastNodesByPath.clear();
  };
}
