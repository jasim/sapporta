/**
 * The time zone a grid writes its dates and timestamps on.
 *
 * Timestamps are stored in UTC and read on a wall clock. Which wall clock is
 * one answer for the whole page: the application publishes it once, before any
 * grid renders, and it does not change while one is mounted — choosing a
 * different zone reloads the page, which rebuilds every column.
 *
 * It is held here rather than passed down because there is nothing else it
 * could be. Every caller that builds a temporal column would pass the same
 * expression, and a parameter that can hold only one value is a parameter that
 * has to be threaded through every constructor, defaulted in every test, and
 * checked at every point it lands. So it is published once and read where it
 * is used, which is one place: the date and timestamp formatters in
 * `defaults.ts`.
 *
 * The zone is a checked `TimeZone`, not a string, so nothing here validates
 * and nothing here can be told an id it cannot render. `@sapporta/frontend`
 * publishes it as `appTimeZone()` from the workspace the reader is signed in
 * to; an application driving the grid itself publishes its own.
 */

import type { TimeZone } from "@sapporta/shared/temporal";

let zone: TimeZone | null = null;

/** Publish the zone every grid on this page reads its moments on. */
export function setDisplayTimeZone(value: TimeZone): void {
  zone = value;
}

/** The zone every grid on this page reads its moments on. */
export function displayTimeZone(): TimeZone {
  if (zone === null) {
    throw new Error(
      "A date or timestamp column was rendered before a display time zone " +
        "was published. Call setDisplayTimeZone() once, before the first " +
        "grid renders.",
    );
  }
  return zone;
}
