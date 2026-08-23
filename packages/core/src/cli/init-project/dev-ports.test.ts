import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEV_API_PORT_BASE,
  DEV_FRONTEND_PORT_BASE,
  DEV_PORT_SLOT_COUNT,
  devServerSummaryLines,
  randomDevPorts,
  usableDevPortSlots,
} from "./dev-ports.js";

const pairs = Array.from({ length: 400 }, () => randomDevPorts());

describe("randomDevPorts", () => {
  it("pairs both ports on one slot inside the windows", () => {
    for (const ports of pairs) {
      const slot = ports.api - DEV_API_PORT_BASE;
      expect(usableDevPortSlots).toContain(slot);
      expect(ports.frontend).toBe(DEV_FRONTEND_PORT_BASE + slot);
    }
  });

  it("never picks a port something else commonly holds", () => {
    // The framework defaults included: another Node server or another Vite is
    // the likeliest thing already listening.
    const reserved = [3000, 3001, 3050, 3128, 5173, 5174, 5222, 5269, 5353];
    for (const ports of pairs) {
      expect(reserved).not.toContain(ports.api);
      expect(reserved).not.toContain(ports.frontend);
    }
  });

  it("stays below the database ports that bound the windows", () => {
    expect(DEV_API_PORT_BASE + DEV_PORT_SLOT_COUNT).toBeLessThan(3306);
    expect(DEV_FRONTEND_PORT_BASE + DEV_PORT_SLOT_COUNT).toBeLessThan(5432);
  });

  it("spreads picks across the window rather than repeating one pair", () => {
    expect(new Set(pairs.map((ports) => ports.api)).size).toBeGreaterThan(100);
  });

  it("gives two projects of the same name different ports", () => {
    // Names repeat across people and machines, which is why the ports are
    // random rather than derived from the project name.
    const repeated = Array.from({ length: 20 }, () => randomDevPorts().api);
    expect(new Set(repeated).size).toBeGreaterThan(1);
  });
});

describe("devServerSummaryLines", () => {
  it("matches the table scripts/dev.mjs prints", () => {
    // The launcher stays dependency-free and writes this table out again, so
    // rebuild its lines here and let the check catch any drift.
    const launcher = readFileSync(
      new URL("../../templates/scripts/dev.mjs", import.meta.url),
      "utf-8",
    );
    const launcherLines = devServerSummaryLines({
      api: 3999,
      frontend: 5999,
    }).map((line) =>
      line
        .replace("http://localhost:5999", "http://localhost:${frontendPort}")
        .replace("http://localhost:3999", "http://localhost:${apiPort}"),
    );

    for (const line of launcherLines) {
      expect(launcher).toContain(line);
    }
  });
});
