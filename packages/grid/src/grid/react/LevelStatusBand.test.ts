import { describe, expect, it } from "vitest";
import { levelStatusBandModel } from "./LevelStatusBand";
import type { LevelSnapshot, LevelSourceState } from "../data-sources/types";

const baseSnapshot: LevelSnapshot = {
  nodes: [],
  serverManaged: { sort: false, filter: false, pagination: false },
};

function state(
  status: LevelSourceState["status"],
  snapshot: LevelSnapshot = baseSnapshot,
  error = new Error("connection refused"),
): LevelSourceState {
  switch (status) {
    case "ready":
      return { status, snapshot };
    case "initialLoading":
      return { status, snapshot, pending: { page: 0, pageSize: 25 } };
    case "refreshing":
      return {
        status,
        snapshot,
        previous: baseSnapshot,
        pending: { page: 0, pageSize: 25 },
      };
    case "initialError":
      return { status, snapshot, error, retry: { page: 0, pageSize: 25 } };
    case "refreshError":
      return {
        status,
        snapshot,
        previous: baseSnapshot,
        error,
        retry: { page: 0, pageSize: 25 },
      };
  }
}

describe("levelStatusBandModel", () => {
  it("returns null when status is ready", () => {
    expect(
      levelStatusBandModel(state("ready"), "rows"),
    ).toBeNull();
  });

  it("returns null when status is refreshing", () => {
    expect(
      levelStatusBandModel(state("refreshing"), "rows"),
    ).toBeNull();
  });

  it("initial loading without pagination uses the bare form", () => {
    const m = levelStatusBandModel(
      state("initialLoading"),
      "rows",
    );
    expect(m).toEqual({ kind: "loading", text: "Loading rows…" });
  });

  it("initial loading with totalCount renders 'page X of Y'", () => {
    const m = levelStatusBandModel(
      state("initialLoading", {
        ...baseSnapshot,
        pagination: { page: 2, pageSize: 25, totalCount: 137 },
      }),
      "orders",
    );
    // 137 / 25 → 6 pages.
    expect(m).toEqual({
      kind: "loading",
      text: "Loading orders, page 2 of 6…",
    });
  });

  it("initial loading with totalCount=0 still renders 1 total page", () => {
    const m = levelStatusBandModel(
      state("initialLoading", {
        ...baseSnapshot,
        pagination: { page: 1, pageSize: 25, totalCount: 0 },
      }),
      "rows",
    );
    expect(m).toEqual({ kind: "loading", text: "Loading rows, page 1 of 1…" });
  });

  it("initial loading with pagination but no totalCount falls back to bare form", () => {
    const m = levelStatusBandModel(
      state("initialLoading", {
        ...baseSnapshot,
        pagination: { page: 1, pageSize: 25 },
      }),
      "rows",
    );
    expect(m).toEqual({ kind: "loading", text: "Loading rows…" });
  });

  it("initial error surfaces the backend message verbatim", () => {
    const m = levelStatusBandModel(
      state("initialError", baseSnapshot, new Error("connection refused")),
      "rows",
    );
    expect(m).toEqual({
      kind: "error",
      text: "Failed to load rows: connection refused",
    });
  });

  it("refresh error renders no blocking band", () => {
    expect(levelStatusBandModel(state("refreshError"), "rows")).toBeNull();
  });
});
