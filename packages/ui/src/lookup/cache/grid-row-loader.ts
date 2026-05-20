import type { ColId, GridPath, GridRuntime } from "@/grid";
import type { ValueLookup } from "./value-lookup";

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

  function attachKnownPaths(): void {
    if (stopped) return;

    for (const path of args.runtime.registeredPaths()) {
      if (subscriptions.has(path)) continue;

      const source = args.runtime.sourceFor(path);
      const loadForPath = () => {
        if (stopped) return;

        const snapshot = source.snapshot();
        if (snapshot.status !== "ready") return;
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

  attachKnownPaths();
  const unsubscribeRegistry = args.runtime.subscribeRegistry(attachKnownPaths);

  return () => {
    stopped = true;
    unsubscribeRegistry();
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    lastNodesByPath.clear();
  };
}
