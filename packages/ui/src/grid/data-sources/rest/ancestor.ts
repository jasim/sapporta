// Ancestor chain — root-to-parent context handed to a level factory at
// `resolveChild` time. URL templates in REST sources read from the chain;
// the keyed `ancestor()` lookup turns a typo or schema rename into a clean
// error at the construction site instead of `undefined.rowKey` downstream.
//
// The chain contains only the ancestors leading down to (but NOT including)
// the level being resolved. The root level's factory receives `ancestors: []`.
// The level being resolved doesn't appear because its rowKey isn't known
// yet at `resolveChild` time — no rows have been fetched.
//
// Lookup is keyed on level name, not array index. Reordering or renaming
// a level in the schema surfaces a clean error at the resolve site
// (`No ancestor at level 'orders' — chain is […]`) instead of a positional
// shift that goes undetected.

import type { RowKey } from "../../types/identity";

export type AncestorEntry = { levelName: string; rowKey: RowKey };

// Ordered root-to-parent chain. Iteration yields root first, immediate
// parent last — useful for breadcrumbs or composing a deep URL prefix
// once. For per-level lookup, prefer `ancestor()`.
export type AncestorChain = ReadonlyArray<AncestorEntry>;

// Render the chain in the form used by error messages and breadcrumbs:
//   []                              — empty chain
//   [orders→O1]                     — single ancestor
//   [orders→O1, lines→L7]           — multiple ancestors
export function renderChain(chain: AncestorChain): string {
  if (chain.length === 0) return "[]";
  return `[${chain.map((e) => `${e.levelName}→${e.rowKey}`).join(", ")}]`;
}

// Returns the rowKey of the ancestor at `levelName`. Throws with the
// rendered chain in the message if no such ancestor exists, so a typo or
// schema rename surfaces precisely at the construction site rather than
// as `undefined.rowKey` downstream.
export function ancestor(chain: AncestorChain, levelName: string): RowKey {
  for (const entry of chain) {
    if (entry.levelName === levelName) return entry.rowKey;
  }
  throw new Error(
    `No ancestor at level '${levelName}' — chain is ${renderChain(chain)}`,
  );
}
