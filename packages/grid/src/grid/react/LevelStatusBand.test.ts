import { describe, expect, it } from "vitest";
import { levelStatusBandModel } from "./LevelStatusBand";
import type { LevelSnapshot, LevelSourceState } from "../data-sources/types";

const baseSnapshot: LevelSnapshot = {
  nodes: [],
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
      return { status, snapshot };
    case "refreshing":
      return {
        status,
        snapshot,
        previous: baseSnapshot,
      };
    case "initialError":
      return { status, snapshot, error };
    case "refreshError":
      return {
        status,
        snapshot,
        previous: baseSnapshot,
        error,
      };
  }
}

describe("levelStatusBandModel", () => {
  it("returns null when status is ready", () => {
    expect(levelStatusBandModel(state("ready"), "rows")).toBeNull();
  });

  it("returns null when status is refreshing", () => {
    expect(levelStatusBandModel(state("refreshing"), "rows")).toBeNull();
  });

  it("initial loading without pagination uses the bare form", () => {
    const m = levelStatusBandModel(state("initialLoading"), "rows");
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
