/**
 * The time zone this page reads timestamps in.
 *
 * Timestamps are stored in UTC and read on a wall clock. Which wall clock is
 * the workspace's business, not the reader's: "revenue for August 24" has to
 * mean the same thing to everyone looking at the same dashboard, so the zone
 * is a column on the workspace row rather than a preference of this browser.
 *
 * It is published once per page load, from the auth context response the boot
 * sequence already fetches, and it does not change while a screen that reads
 * it is mounted. That is what lets every reader below take it as a plain
 * value, with no hook to subscribe to and nothing asynchronous in the render
 * path.
 *
 * The value itself is held in `@sapporta/grid`, which needs it to write a
 * cell and cannot import from here. One holder, so the grid and this
 * application cannot come to disagree about the day a row falls on; this
 * module is the name the rest of the frontend knows it by, and the edge where
 * the stored id is checked.
 */

import {
  setDisplayTimeZone,
  displayTimeZone,
} from "@sapporta/grid/column-preset";
import { parseTimeZone, type TimeZone } from "@sapporta/shared/temporal";

/**
 * Publish the zone the active workspace keeps.
 *
 * Called from `sessionFromContext`, which is the one function both restoring a
 * session and switching workspaces route through, and which runs before
 * `BootLoader` lets any authenticated route render.
 *
 * The id is checked here rather than trusted, because a zone renamed out from
 * under a stored workspace row would otherwise be discovered inside a cell
 * renderer, with nowhere to report it.
 */
export function setAppTimeZone(value: string): void {
  setDisplayTimeZone(parseTimeZone(value));
}

/** The zone every timestamp on this page is written in. */
export function appTimeZone(): TimeZone {
  return displayTimeZone();
}
