import { describe, expect, it } from "vitest";
import { levelStatusBandModel } from "./LevelStatusBand";
import type { LevelSnapshot } from "../data-sources/types";

const baseSnapshot: LevelSnapshot = {
  status: "ready",
  nodes: [],
  serverManaged: { sort: false, filter: false, pagination: false },
};

describe("levelStatusBandModel", () => {
  it("returns null when status is ready", () => {
    expect(
      levelStatusBandModel({ ...baseSnapshot, status: "ready" }, "rows"),
    ).toBeNull();
  });

  it("returns null when status is idle", () => {
    expect(
      levelStatusBandModel({ ...baseSnapshot, status: "idle" }, "rows"),
    ).toBeNull();
  });

  it("loading without pagination uses the bare form", () => {
    const m = levelStatusBandModel(
      { ...baseSnapshot, status: "loading" },
      "rows",
    );
    expect(m).toEqual({ kind: "loading", text: "Loading rows…" });
  });

  it("loading with totalCount renders 'page X of Y'", () => {
    const m = levelStatusBandModel(
      {
        ...baseSnapshot,
        status: "loading",
        pagination: { page: 2, pageSize: 25, totalCount: 137 },
      },
      "orders",
    );
    // 137 / 25 → 6 pages.
    expect(m).toEqual({
      kind: "loading",
      text: "Loading orders, page 2 of 6…",
    });
  });

  it("loading with totalCount=0 still renders 1 total page", () => {
    const m = levelStatusBandModel(
      {
        ...baseSnapshot,
        status: "loading",
        pagination: { page: 1, pageSize: 25, totalCount: 0 },
      },
      "rows",
    );
    expect(m).toEqual({ kind: "loading", text: "Loading rows, page 1 of 1…" });
  });

  it("loading with pagination but no totalCount falls back to bare form", () => {
    const m = levelStatusBandModel(
      {
        ...baseSnapshot,
        status: "loading",
        pagination: { page: 1, pageSize: 25 },
      },
      "rows",
    );
    expect(m).toEqual({ kind: "loading", text: "Loading rows…" });
  });

  it("error surfaces the backend message verbatim", () => {
    const m = levelStatusBandModel(
      {
        ...baseSnapshot,
        status: "error",
        error: new Error("connection refused"),
      },
      "rows",
    );
    expect(m).toEqual({
      kind: "error",
      text: "Failed to load rows: connection refused",
    });
  });

  it("error without an Error instance still renders a band", () => {
    // Defensive guard: shape is determined by `status === 'error'` alone,
    // not by the presence of `error`. The framing is still emitted; the
    // verbatim portion is empty.
    const m = levelStatusBandModel(
      { ...baseSnapshot, status: "error" },
      "rows",
    );
    expect(m).toEqual({ kind: "error", text: "Failed to load rows: " });
  });
});
