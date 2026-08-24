import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Nothing may ask the machine what time zone it is in, or what day it is,
 * except where that question is the point.
 *
 * `Temporal.Now.plainDateISO()` with no argument and `Temporal.Now.timeZoneId()`
 * both answer from the host's `TZ`. A "last 7 days" report built on either
 * returns different rows depending on whether the container was started with
 * `TZ=UTC` or `TZ=Asia/Kolkata`, and nothing about the call site says so. A
 * day belongs to the workspace's calendar: read it with `workspaceTimeZone()`
 * on the server and `appTimeZone()` in the browser, and pass a
 * `Temporal.Instant` wherever "now" is needed.
 *
 * `deviceTimeZone()` is the one legitimate reader of an ambient zone, and it
 * has exactly one caller: the sign-up request, which sends the browser's zone
 * so that the first workspace an account creates starts on the calendar its
 * owner keeps.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const forbidden = [
  // With an argument it is a zone the caller named, which is fine.
  {
    call: "Temporal.Now.plainDateISO()",
    pattern: /Temporal\.Now\.plainDateISO\(\s*\)/,
  },
  { call: "Temporal.Now.timeZoneId()", pattern: /Temporal\.Now\.timeZoneId\(/ },
  { call: "deviceTimeZone()", pattern: /\bdeviceTimeZone\(/ },
] as const;

const everyForbiddenCall = forbidden.map(({ call }) => call);

/** Where a forbidden call is the subject rather than a mistake. */
const allowed = new Map<string, readonly string[]>([
  // Declares `deviceTimeZone()` and is the one place that reads the ambient
  // zone to answer it.
  [
    "packages/shared/src/temporal.ts",
    ["Temporal.Now.timeZoneId()", "deviceTimeZone()"],
  ],
  // Covers `deviceTimeZone()` itself.
  ["packages/shared/src/temporal.test.ts", ["deviceTimeZone()"]],
  // The sign-up request, which is the one place the browser's own zone is sent.
  ["packages/frontend/src/auth/components/AuthPages.tsx", ["deviceTimeZone()"]],
  // This file names every one of them, in `forbidden` above and in the prose
  // explaining it, so it is exempt from all of them rather than from a list
  // repeated here that could fall out of step with that one.
  ["tests/ambient-time-zone.test.ts", everyForbiddenCall],
]);

describe("ambient time zone readers", () => {
  it("are called only where reading the machine's own setting is the point", () => {
    const offenders = trackedSourceFiles().flatMap((file) => {
      const exempt = allowed.get(file);
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      return forbidden
        .filter(({ call, pattern }) => {
          if (exempt?.includes(call)) return false;
          return pattern.test(source);
        })
        .map(({ call }) => `${file}: ${call}`);
    });

    expect(offenders).toEqual([]);
  });
});

/**
 * Every checked-in TypeScript source file, scaffold templates included.
 *
 * The index still lists a file deleted in the working tree, which is not
 * source to scan, so the list is narrowed to what is actually there.
 */
function trackedSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.example"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file !== "" && existsSync(path.join(repoRoot, file)));
}
