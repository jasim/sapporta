// REST-backed `GridDataSource`. Each level's endpoint factory closes over
// the resolved ancestor chain so URL templates can read like the URLs
// (`/api/orders/${orderId}/lines/${lineId}/notes`).
//
// Shape diverges from `inMemoryGridDataSource` deliberately. In-memory
// data is structurally indexed — `resolveChild` is a tree walk and the
// per-level config is static. REST data needs URLs, and URLs contain
// parent IDs that vary per parent. The factory shape with an `ancestors`
// parameter is the seam where those IDs land in the right order.
// Hosts that genuinely need per-parent in-memory variation write a custom
// `GridDataSource` instead of forcing in-memory through a factory shape
// with an `ancestors` parameter that the impl never reads.
//
// Ancestor reconstruction. The runtime calls
// `resolveChild(parentPath, parentRowKey, childLevelName)`; `parentPath`
// already encodes every (levelName, rowKey) pair from root down through
// the parent's parent, and `parentRowKey` adds the parent's own rowKey.
// Walking the path segments yields the chain leading down to (but not
// including) the level being resolved — exactly what the design prescribes
// for the factory's `ctx.ancestors`. The chain does NOT include the level
// being resolved because that level's rowKey is not yet known at
// resolveChild time (no rows have been fetched). No memoization needed:
// the walk is O(depth), and the runtime caches the resolved source
// itself so we are invoked at most once per `(parentPath, parentRowKey,
// childLevelName)`.
//
// Lifecycle. The runtime owns every returned level source. Grid-source
// disposal releases only factory-level state and never disposes those sources.
// `resolveChild` is a pure factory — it returns a fresh source on each call and
// never caches. The runtime's registry ensures it is invoked at most once per
// child key.

import { decomposePath } from "../../types/identity";
import type { GridPath, RowKey } from "../../types/identity";
import type { GridSchema } from "../../types/schema";
import type { AncestorChain, AncestorEntry } from "./ancestor";
import { restLevelSource, type RestLevelSourceOpts } from "./rest-level-source";
import type { GridDataSource, LevelDataSource } from "../types";

export type RestEndpointFactory<F = unknown> = (ctx: {
  ancestors: AncestorChain;
}) => RestLevelSourceOpts<F>;

export type RestGridDataSourceOpts<F = unknown> = {
  schema: GridSchema;
  endpoints: { [levelName: string]: RestEndpointFactory<F> };
};

export function restGridDataSource<F = unknown>(
  opts: RestGridDataSourceOpts<F>,
): GridDataSource {
  const { schema, endpoints } = opts;

  if (!schema.levels[schema.rootLevel]) {
    throw new Error(
      `restGridDataSource: schema.rootLevel '${schema.rootLevel}' not found in schema.levels (available: ${Object.keys(schema.levels).join(", ") || "<none>"})`,
    );
  }

  let rootCached: LevelDataSource | null = null;

  function buildLevel(
    levelName: string,
    ancestors: AncestorChain,
  ): LevelDataSource {
    const factory = endpoints[levelName];
    if (!factory) {
      throw new Error(
        `restGridDataSource: endpoints has no entry for level '${levelName}'`,
      );
    }
    const levelSchema = schema.levels[levelName];
    if (!levelSchema) {
      throw new Error(
        `restGridDataSource: schema.levels has no entry for level '${levelName}'`,
      );
    }
    return restLevelSource<F>(factory({ ancestors }));
  }

  return {
    rootSource() {
      if (rootCached === null) {
        rootCached = buildLevel(schema.rootLevel, []);
      }
      return rootCached;
    },

    resolveChild(parentPath, parentRowKey, childLevelName) {
      const ancestors = chainFor(parentPath, parentRowKey, schema);
      return buildLevel(childLevelName, ancestors);
    },

    dispose() {
      rootCached = null;
    },
  };
}

// Decode the chain that leads down to (but does not include) the level
// being resolved. The parent's own rowKey arrives separately as
// `parentRowKey`, paired with the path's tail level name. All path
// parsing is delegated to `decomposePath` in `identity.ts`.
function chainFor(
  parentPath: GridPath,
  parentRowKey: RowKey,
  schema: GridSchema,
): AncestorChain {
  const decomp = decomposePath(parentPath);
  if (decomp.rootLevelName !== schema.rootLevel) {
    throw new Error(
      `restGridDataSource: parentPath '${parentPath}' root segment '${decomp.rootLevelName}' does not match schema.rootLevel '${schema.rootLevel}'`,
    );
  }
  if (parentRowKey === "") {
    throw new Error(
      "restGridDataSource: parentRowKey must be a non-empty string",
    );
  }
  const chain: AncestorEntry[] = [];
  let levelName = decomp.rootLevelName;
  for (const edge of decomp.edges) {
    chain.push({ levelName, rowKey: edge.rowKey });
    levelName = edge.levelName;
  }
  chain.push({ levelName, rowKey: parentRowKey });
  return chain;
}
