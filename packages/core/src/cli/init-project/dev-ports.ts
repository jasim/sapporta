import { randomInt } from "node:crypto";

/**
 * The development ports a generated project starts on.
 *
 * Scaffolding every project onto one pair of ports makes the second project on
 * a machine collide with the first the moment both run `pnpm dev`. Each new
 * project gets a random pair instead. Deriving them from the project name
 * would collide just as reliably, because names repeat: several people work on
 * the same project, and names like `blog` or `crm` get reused.
 *
 * This applies to development only. In a deployment the API binds a single
 * local port behind a reverse proxy — conventionally 3000, which is what
 * `.env.production.example` and the Dockerfile use — and no frontend server
 * runs at all, so there is nothing to spread out.
 */

/** The framework defaults, which the code fallbacks also use. */
export const DEV_API_PORT_BASE = 3000;
export const DEV_FRONTEND_PORT_BASE = 5173;

/**
 * Both ports move together by one offset, so a project occupies a single
 * numbered slot. Two projects collide only when they land on the same slot,
 * where picking each port independently would let them collide on either one.
 *
 * 256 slots is what the windows allow: MySQL sits at 3306 and PostgreSQL at
 * 5432, both above the last slot's 3255 and 5428.
 */
export const DEV_PORT_SLOT_COUNT = 256;

/**
 * Ports inside the windows that something else commonly holds. The framework
 * defaults are among them: 3000 and 3001 are what most Node servers start on,
 * and 5173 and 5174 are Vite's own, so a generated project that took them
 * would collide with whatever else the machine is already running.
 */
const RESERVED_PORTS = new Set([
  3000, 3001, 3050 /* Firebird */, 3128 /* Squid */, 5173, 5174,
  5222 /* XMPP */, 5269 /* XMPP server */, 5353 /* mDNS */,
]);

const USABLE_SLOTS = Array.from(
  { length: DEV_PORT_SLOT_COUNT },
  (_unused, slot) => slot,
).filter(
  (slot) =>
    !RESERVED_PORTS.has(DEV_API_PORT_BASE + slot) &&
    !RESERVED_PORTS.has(DEV_FRONTEND_PORT_BASE + slot),
);

export interface DevPorts {
  api: number;
  frontend: number;
}

/** Pick a random port pair for a new project. */
export function randomDevPorts(): DevPorts {
  const slot = USABLE_SLOTS[randomInt(USABLE_SLOTS.length)];
  return {
    api: DEV_API_PORT_BASE + slot,
    frontend: DEV_FRONTEND_PORT_BASE + slot,
  };
}

/** Exposed so tests can state which slots may be picked. */
export const usableDevPortSlots: readonly number[] = USABLE_SLOTS;

/**
 * The two development servers, each line naming who uses that URL: a person
 * opens the app in a browser, scripts and coding agents call the API.
 *
 * `scripts/dev.mjs` prints the same table. It repeats this text rather than
 * importing it, to stay dependency-free; keep the two in step.
 */
export function devServerSummaryLines(ports: DevPorts): string[] {
  return [
    "Development servers for this project, on ports set in .env.development:",
    "",
    `  App   http://localhost:${ports.frontend}   open this in a browser`,
    `  API   http://localhost:${ports.api}   call directly from scripts and coding agents`,
  ];
}
